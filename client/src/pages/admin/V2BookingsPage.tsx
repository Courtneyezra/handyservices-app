import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface V2Booking {
    id: string;
    reference: string;
    customerFirstName: string;
    customerLastName: string;
    customerEmail: string;
    customerPhone: string;
    addressLine1: string;
    addressLine2: string | null;
    town: string;
    postcode: string;
    services: unknown;
    slotDate: string;
    slotLabel: string;
    slotSurcharge: number;
    subtotal: number;
    visitFee: number;
    weekendSurcharge: number;
    eveningSurcharge: number;
    total: number;
    variant: string | null;
    status: string;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
}

function formatCurrency(pounds: number): string {
    // total/subtotal stored as whole pounds (per BookingFlowV2 totals)
    return `£${pounds.toFixed(2)}`;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
    if (status === "confirmed" || status === "paid") return "default";
    if (status === "pending_payment") return "secondary";
    if (status === "cancelled" || status === "failed") return "destructive";
    return "outline";
}

export default function V2BookingsPage() {
    const { data: bookings, isLoading, error } = useQuery<V2Booking[]>({
        queryKey: ["/api/v2/bookings"],
        queryFn: async () => {
            const res = await fetch("/api/v2/bookings");
            if (!res.ok) throw new Error("Failed to fetch v2 bookings");
            return res.json();
        },
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-12">
                <Loader2 className="h-6 w-6 animate-spin" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-6">
                <Card>
                    <CardContent className="p-6 text-sm text-red-600">
                        Failed to load V2 bookings.
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-4 p-6">
            <Card>
                <CardHeader>
                    <CardTitle>V2 Bookings</CardTitle>
                    <p className="text-sm text-slate-500">
                        Bookings created through the /v2 funnel (basket → date → address → review).
                    </p>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b text-left text-xs uppercase tracking-wider text-slate-500">
                                    <th className="py-2 pr-4">Reference</th>
                                    <th className="py-2 pr-4">Customer</th>
                                    <th className="py-2 pr-4">Email</th>
                                    <th className="py-2 pr-4">Slot</th>
                                    <th className="py-2 pr-4">Total</th>
                                    <th className="py-2 pr-4">Status</th>
                                    <th className="py-2 pr-4">Created</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(bookings ?? []).map((b) => (
                                    <tr key={b.id} className="border-b last:border-0">
                                        <td className="py-3 pr-4 font-mono text-xs">
                                            {b.reference}
                                        </td>
                                        <td className="py-3 pr-4">
                                            {b.customerFirstName} {b.customerLastName}
                                            <div className="text-xs text-slate-500">
                                                {b.customerPhone}
                                            </div>
                                        </td>
                                        <td className="py-3 pr-4 text-xs text-slate-600">
                                            {b.customerEmail}
                                        </td>
                                        <td className="py-3 pr-4">
                                            <div className="font-medium">
                                                {b.slotDate}
                                            </div>
                                            <div className="text-xs text-slate-500">
                                                {b.slotLabel}
                                            </div>
                                        </td>
                                        <td className="py-3 pr-4 font-medium">
                                            {formatCurrency(b.total)}
                                        </td>
                                        <td className="py-3 pr-4">
                                            <Badge variant={statusVariant(b.status)}>
                                                {b.status}
                                            </Badge>
                                        </td>
                                        <td className="py-3 pr-4 text-xs text-slate-500">
                                            {b.createdAt
                                                ? format(new Date(b.createdAt), "d MMM yyyy HH:mm")
                                                : "—"}
                                        </td>
                                    </tr>
                                ))}
                                {(!bookings || bookings.length === 0) && (
                                    <tr>
                                        <td
                                            colSpan={7}
                                            className="py-6 text-center text-sm text-slate-500"
                                        >
                                            No V2 bookings yet.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
