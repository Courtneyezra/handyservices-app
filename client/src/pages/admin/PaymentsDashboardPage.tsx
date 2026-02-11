import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, CreditCard, TrendingUp, Calendar, Banknote, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

interface PaymentSummary {
    today: { total: number; count: number };
    week: { total: number; count: number };
    month: { total: number; count: number };
    allTime: { total: number; count: number };
}

interface RecentPayment {
    id: string;
    shortSlug: string;
    customerName: string;
    phone: string;
    depositAmountPence: number;
    depositPaidAt: string;
    paymentType: string | null;
    stripePaymentIntentId: string | null;
    selectedPackage: string | null;
    segment: string | null;
}

function formatCurrency(pence: number): string {
    return `\u00A3${(pence / 100).toFixed(2)}`;
}

function SummaryCard({ title, total, count, icon: Icon, className = "" }: {
    title: string;
    total: number;
    count: number;
    icon: React.ComponentType<{ className?: string }>;
    className?: string;
}) {
    return (
        <Card className={className}>
            <CardContent className="p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm text-muted-foreground">{title}</p>
                        <p className="text-2xl font-bold mt-1">{formatCurrency(total)}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                            {count} payment{count !== 1 ? 's' : ''}
                        </p>
                    </div>
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                        <Icon className="h-6 w-6 text-primary" />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

export default function PaymentsDashboardPage() {
    // Fetch payment summary
    const { data: summary, isLoading: summaryLoading } = useQuery<PaymentSummary>({
        queryKey: ["paymentsSummary"],
        queryFn: async () => {
            const res = await fetch("/api/admin/payments/summary");
            if (!res.ok) throw new Error("Failed to fetch payment summary");
            return res.json();
        },
        refetchInterval: 60000, // Refresh every minute
    });

    // Fetch recent payments
    const { data: recentPayments, isLoading: paymentsLoading } = useQuery<RecentPayment[]>({
        queryKey: ["recentPayments"],
        queryFn: async () => {
            const res = await fetch("/api/admin/payments/recent?limit=20");
            if (!res.ok) throw new Error("Failed to fetch recent payments");
            return res.json();
        },
        refetchInterval: 30000, // Refresh every 30 seconds
    });

    const isLoading = summaryLoading || paymentsLoading;

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
        );
    }

    return (
        <div className="container mx-auto p-6 space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-gray-900">Payments Dashboard</h1>
                <p className="text-gray-500 mt-1">Track deposits and payments from quote bookings.</p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <SummaryCard
                    title="Today"
                    total={summary?.today.total || 0}
                    count={summary?.today.count || 0}
                    icon={Calendar}
                />
                <SummaryCard
                    title="This Week"
                    total={summary?.week.total || 0}
                    count={summary?.week.count || 0}
                    icon={TrendingUp}
                />
                <SummaryCard
                    title="This Month"
                    total={summary?.month.total || 0}
                    count={summary?.month.count || 0}
                    icon={Banknote}
                />
                <SummaryCard
                    title="All Time"
                    total={summary?.allTime.total || 0}
                    count={summary?.allTime.count || 0}
                    icon={CreditCard}
                    className="border-primary/20"
                />
            </div>

            {/* Recent Payments Table */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <CreditCard className="h-5 w-5" />
                        Recent Payments
                    </CardTitle>
                    <CardDescription>
                        The most recent deposit payments received.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {recentPayments && recentPayments.length > 0 ? (
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Customer</TableHead>
                                        <TableHead>Quote</TableHead>
                                        <TableHead>Package</TableHead>
                                        <TableHead className="text-right">Amount</TableHead>
                                        <TableHead className="text-right">Date</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {recentPayments.map((payment) => (
                                        <TableRow key={payment.id}>
                                            <TableCell>
                                                <div>
                                                    <span className="font-medium">{payment.customerName}</span>
                                                    <span className="text-xs text-muted-foreground block">{payment.phone}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{payment.shortSlug}</code>
                                            </TableCell>
                                            <TableCell>
                                                {payment.selectedPackage ? (
                                                    <Badge variant="outline" className="capitalize">
                                                        {payment.selectedPackage}
                                                    </Badge>
                                                ) : (
                                                    <span className="text-muted-foreground">-</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-green-600 font-medium">
                                                {formatCurrency(payment.depositAmountPence)}
                                            </TableCell>
                                            <TableCell className="text-right text-sm text-muted-foreground">
                                                {format(new Date(payment.depositPaidAt), 'dd MMM yyyy, HH:mm')}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => window.open(`/quote-link/${payment.shortSlug}`, '_blank')}
                                                    >
                                                        <ExternalLink className="h-4 w-4" />
                                                    </Button>
                                                    {payment.stripePaymentIntentId && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => window.open(`https://dashboard.stripe.com/payments/${payment.stripePaymentIntentId}`, '_blank')}
                                                            title="View in Stripe"
                                                        >
                                                            <CreditCard className="h-4 w-4 text-purple-600" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    ) : (
                        <p className="text-center text-muted-foreground py-8">No payments recorded yet.</p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
