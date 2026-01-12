
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "../../lib/queryClient";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "../../components/ui/table";
import { Plus, Layout } from "lucide-react";
import { LandingPage, LandingPageVariant } from "../../hooks/useLandingPage";
import { Badge } from "../../components/ui/badge";

export default function AdminLandingPages() {
    const queryClient = useQueryClient();

    const { data: pages, isLoading } = useQuery<LandingPage[]>({
        queryKey: ["admin-landing-pages"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/landing-pages");
            return res.json();
        }
    });

    const createMutation = useMutation({
        mutationFn: async () => {
            const name = prompt("Enter internal name for new landing page:");
            if (!name) return;
            const slug = prompt("Enter URL slug (e.g. spring-sale):", name.toLowerCase().replace(/ /g, '-'));
            if (!slug) return;

            const res = await apiRequest("POST", "/api/landing-pages", {
                name,
                slug,
                isActive: true
            });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["admin-landing-pages"] });
        }
    });

    if (isLoading) return <div className="p-8">Loading...</div>;

    // Helper to calculate total stats across variants
    const getStats = (variants: LandingPageVariant[]) => {
        return variants.reduce((acc, v) => ({
            views: acc.views + (v as any).viewCount,
            conversions: acc.conversions + (v as any).conversionCount
        }), { views: 0, conversions: 0 });
    };

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Landing Pages</h1>
                    <p className="text-muted-foreground mt-2">
                        Manage your marketing landing pages and optimize for conversions.
                    </p>
                </div>
                <Button onClick={() => createMutation.mutate()}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create New Page
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>All Pages</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Slug</TableHead>
                                <TableHead>Variants</TableHead>
                                <TableHead>Views</TableHead>
                                <TableHead>Conversions</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {pages?.map((page: any) => {
                                const stats = getStats(page.variants || []);
                                const rate = stats.views > 0 ? ((stats.conversions / stats.views) * 100).toFixed(1) : "0.0";

                                return (
                                    <TableRow key={page.id}>
                                        <TableCell className="font-medium">
                                            <div className="flex items-center gap-2">
                                                <Layout className="h-4 w-4 text-blue-500" />
                                                {page.name}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <code className="text-xs bg-muted px-1 py-0.5 rounded">
                                                {page.slug === 'landing' || page.slug === 'derby' ? `/${page.slug}` : `/l/${page.slug}`}
                                            </code>
                                        </TableCell>
                                        <TableCell>{page.variants?.length || 0}</TableCell>
                                        <TableCell>{stats.views}</TableCell>
                                        <TableCell>
                                            {stats.conversions} <span className="text-muted-foreground text-xs">({rate}%)</span>
                                        </TableCell>
                                        <TableCell>
                                            {page.isActive ?
                                                <Badge className="bg-green-500">Active</Badge> :
                                                <Badge variant="secondary">Inactive</Badge>
                                            }
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Link href={`/admin/landing-pages/${page.id}`}>
                                                <Button variant="outline" size="sm">
                                                    Edit & Optimize
                                                </Button>
                                            </Link>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                            {pages?.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">
                                        No landing pages created yet.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
