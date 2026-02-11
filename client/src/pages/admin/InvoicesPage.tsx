import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, Plus, Download, Send, CreditCard, MoreHorizontal, FileText } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

interface Invoice {
    id: string;
    invoiceNumber: string;
    customerName: string;
    customerEmail: string | null;
    totalAmount: number;
    balanceDue: number;
    status: string;
    createdAt: string;
    pdfUrl: string | null;
    jobId: string | null;
}

export default function InvoicesPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: invoices, isLoading } = useQuery<Invoice[]>({
        queryKey: ["invoices"],
        queryFn: async () => {
            const res = await fetch("/api/invoices");
            if (!res.ok) throw new Error("Failed to fetch invoices");
            return res.json();
        },
    });

    const markPaidMutation = useMutation({
        mutationFn: async (id: string) => {
            const res = await fetch(`/api/invoices/${id}/mark-paid`, {
                method: "POST",
            });
            if (!res.ok) throw new Error("Failed to mark as paid");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["invoices"] });
            toast({
                title: "Invoice Updated",
                description: "Invoice marked as paid successfully.",
            });
        },
        onError: () => {
            toast({
                title: "Error",
                description: "Failed to update invoice.",
                variant: "destructive",
            });
        },
    });

    const sendInvoiceMutation = useMutation({
        mutationFn: async (id: string) => {
            const res = await fetch(`/api/invoices/${id}/send`, {
                method: "POST",
            });
            if (!res.ok) throw new Error("Failed to send invoice");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["invoices"] });
            toast({
                title: "Invoice Sent",
                description: "Invoice has been sent to the customer.",
            });
        },
        onError: () => {
            toast({
                title: "Error",
                description: "Failed to send invoice.",
                variant: "destructive",
            });
        },
    });

    const getStatusColor = (status: string) => {
        switch (status) {
            case "paid":
                return "bg-green-100 text-green-800 hover:bg-green-100 border-green-200";
            case "overdue":
                return "bg-red-100 text-red-800 hover:bg-red-100 border-red-200";
            case "sent":
                return "bg-blue-100 text-blue-800 hover:bg-blue-100 border-blue-200";
            case "draft":
                return "bg-gray-100 text-gray-800 hover:bg-gray-100 border-gray-200";
            default:
                return "bg-gray-100 text-gray-800";
        }
    };

    const formatCurrency = (amount: string | number) => {
        // Amounts are stored in pence, convert to pounds
        const pence = typeof amount === 'string' ? parseFloat(amount) : amount;
        return new Intl.NumberFormat("en-GB", {
            style: "currency",
            currency: "GBP",
        }).format(pence / 100);
    };

    if (isLoading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const totalRevenue = invoices
        ?.filter((i) => i.status === "paid")
        .reduce((acc, curr) => acc + parseFloat(curr.totalAmount), 0) || 0;

    const outstandingAmount = invoices
        ?.filter((i) => i.status !== "paid" && i.status !== "void")
        .reduce((acc, curr) => acc + parseFloat(curr.balanceDue), 0) || 0;

    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">Invoices</h1>
                    <p className="text-muted-foreground mt-1">Manage billing and payments</p>
                </div>
                <div className="flex gap-2">
                    {/* Create Invoice button could go here eventually */}
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                        <CreditCard className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{formatCurrency(totalRevenue.toString())}</div>
                        <p className="text-xs text-muted-foreground">Lifetime collected</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Outstanding</CardTitle>
                        <FileText className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-amber-600">{formatCurrency(outstandingAmount.toString())}</div>
                        <p className="text-xs text-muted-foreground">Unpaid balances</p>
                    </CardContent>
                </Card>
            </div>

            <Card className="bg-card border-border shadow-sm">
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <CardTitle>Recent Invoices</CardTitle>
                        <div className="text-sm text-muted-foreground">
                            {invoices?.length || 0} invoices found
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {!invoices?.length ? (
                        <div className="text-center py-10 text-muted-foreground">
                            No invoices generated yet.
                        </div>
                    ) : (
                        <div className="rounded-md border">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-muted/50 text-muted-foreground">
                                    <tr>
                                        <th className="p-4 font-medium">Invoice #</th>
                                        <th className="p-4 font-medium">Date</th>
                                        <th className="p-4 font-medium">Customer</th>
                                        <th className="p-4 font-medium">Amount</th>
                                        <th className="p-4 font-medium">Status</th>
                                        <th className="p-4 font-medium text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {invoices.map((invoice) => (
                                        <tr key={invoice.id} className="hover:bg-muted/50 transition-colors">
                                            <td className="p-4 font-medium">
                                                {invoice.invoiceNumber}
                                                {invoice.jobId && (
                                                    <div className="text-xs text-muted-foreground mt-0.5">
                                                        Job #{invoice.jobId}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-4 text-muted-foreground">
                                                {format(new Date(invoice.createdAt), "MMM d, yyyy")}
                                            </td>
                                            <td className="p-4">
                                                <div className="font-medium">{invoice.customerName}</div>
                                                <div className="text-xs text-muted-foreground">{invoice.customerEmail}</div>
                                            </td>
                                            <td className="p-4">
                                                <div className="font-medium">{formatCurrency(invoice.totalAmount)}</div>
                                                {parseFloat(invoice.balanceDue) > 0 && parseFloat(invoice.balanceDue) < parseFloat(invoice.totalAmount) && (
                                                    <div className="text-xs text-amber-600">Due: {formatCurrency(invoice.balanceDue)}</div>
                                                )}
                                            </td>
                                            <td className="p-4">
                                                <Badge variant="outline" className={getStatusColor(invoice.status)}>
                                                    {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                                                </Badge>
                                            </td>
                                            <td className="p-4 text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8">
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                        <DropdownMenuItem onClick={() => navigator.clipboard.writeText(invoice.invoiceNumber)}>
                                                            Copy Invoice #
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        {invoice.status !== 'paid' && (
                                                            <DropdownMenuItem onClick={() => markPaidMutation.mutate(invoice.id)}>
                                                                <CreditCard className="mr-2 h-4 w-4" /> Mark as Paid
                                                            </DropdownMenuItem>
                                                        )}
                                                        {(invoice.status === 'draft' || invoice.status === 'sent') && (
                                                            <DropdownMenuItem onClick={() => sendInvoiceMutation.mutate(invoice.id)}>
                                                                <Send className="mr-2 h-4 w-4" /> Send Invoice
                                                            </DropdownMenuItem>
                                                        )}
                                                        {invoice.pdfUrl && (
                                                            <DropdownMenuItem asChild>
                                                                <a href={invoice.pdfUrl} target="_blank" rel="noopener noreferrer">
                                                                    <Download className="mr-2 h-4 w-4" /> Download PDF
                                                                </a>
                                                            </DropdownMenuItem>
                                                        )}
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
