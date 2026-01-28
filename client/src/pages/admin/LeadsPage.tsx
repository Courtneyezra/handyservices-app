import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, Phone, Mail, MessageSquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Lead {
    id: string;
    customerName: string;
    phone: string;
    email: string | null;
    jobDescription: string;
    source: string;
    status: string;
    createdAt: string;
}

export default function LeadsPage() {
    const { data: leads, isLoading } = useQuery<Lead[]>({
        queryKey: ["admin-leads"],
        queryFn: async () => {
            const res = await fetch("/api/leads");
            if (!res.ok) throw new Error("Failed to fetch leads");
            return res.json();
        },
        refetchInterval: 30000,
    });

    if (isLoading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Leads</h1>
                <Button onClick={() => window.location.reload()} variant="outline" size="sm">
                    Refresh
                </Button>
            </div>

            <Card className="bg-card border-border shadow-sm">
                <CardHeader>
                    <CardTitle>Incoming Leads</CardTitle>
                </CardHeader>
                <CardContent>
                    {!leads?.length ? (
                        <div className="text-center py-10 text-muted-foreground">
                            No leads found.
                        </div>
                    ) : (
                        <div className="rounded-md border">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-muted/50 text-muted-foreground">
                                    <tr>
                                        <th className="p-4 font-medium">Customer</th>
                                        <th className="p-4 font-medium">Contact</th>
                                        <th className="p-4 font-medium">Request</th>
                                        <th className="p-4 font-medium">Source</th>
                                        <th className="p-4 font-medium">Date</th>
                                        <th className="p-4 font-medium text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {leads.map((lead) => (
                                        <tr key={lead.id} className="hover:bg-muted/50 transition-colors">
                                            <td className="p-4">
                                                <div className="font-medium text-foreground">{lead.customerName}</div>
                                                <Badge variant="outline" className="mt-1 text-xs">
                                                    {lead.status}
                                                </Badge>
                                            </td>
                                            <td className="p-4 space-y-1">
                                                <div className="flex items-center gap-2 text-muted-foreground">
                                                    <Phone className="h-3 w-3" />
                                                    <a href={`tel:${lead.phone}`} className="hover:text-primary transition-colors">
                                                        {lead.phone}
                                                    </a>
                                                </div>
                                                {lead.email && (
                                                    <div className="flex items-center gap-2 text-muted-foreground">
                                                        <Mail className="h-3 w-3" />
                                                        <span className="truncate max-w-[150px]">{lead.email}</span>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-4">
                                                <p className="line-clamp-2 text-muted-foreground max-w-md" title={lead.jobDescription}>
                                                    {lead.jobDescription}
                                                </p>
                                            </td>
                                            <td className="p-4">
                                                <Badge variant="secondary" className="font-normal capitalize">
                                                    {lead.source?.replace(/_/g, " ") || "Website"}
                                                </Badge>
                                            </td>
                                            <td className="p-4 text-muted-foreground whitespace-nowrap">
                                                {format(new Date(lead.createdAt), "MMM d, h:mm a")}
                                            </td>
                                            <td className="p-4 text-right">
                                                <Button size="sm" variant="ghost" asChild>
                                                    <a href={`tel:${lead.phone}`}>
                                                        <Phone className="h-4 w-4 mr-2" />
                                                        Call
                                                    </a>
                                                </Button>
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
