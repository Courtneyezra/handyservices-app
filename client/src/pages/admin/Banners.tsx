
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { Plus, Megaphone, Trash2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "../../hooks/use-toast";

export default function AdminBanners() {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const [isCreateOpen, setIsCreateOpen] = useState(false);

    const { data: banners, isLoading } = useQuery<any[]>({
        queryKey: ["admin-banners"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/banners");
            return res.json();
        }
    });

    const createMutation = useMutation({
        mutationFn: async (data: any) => {
            const res = await apiRequest("POST", "/api/banners", data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["admin-banners"] });
            setIsCreateOpen(false);
            toast({ title: "Banner Created" });
        }
    });

    const toggleStatusMutation = useMutation({
        mutationFn: async ({ id, isActive }: { id: number, isActive: boolean }) => {
            const res = await apiRequest("PATCH", `/api/banners/${id}`, { isActive });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["admin-banners"] });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            if (!confirm("Delete this banner?")) return;
            await apiRequest("DELETE", `/api/banners/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["admin-banners"] });
            toast({ title: "Banner Deleted" });
        }
    });

    if (isLoading) return <div className="p-8">Loading...</div>;

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Site Banners</h1>
                    <p className="text-muted-foreground mt-2">
                        Manage global announcements and top bars.
                    </p>
                </div>

                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="mr-2 h-4 w-4" />
                            New Banner
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Create New Banner</DialogTitle>
                        </DialogHeader>
                        <BannerForm onSubmit={(data: any) => createMutation.mutate(data)} />
                    </DialogContent>
                </Dialog>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>All Banners</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Content</TableHead>
                                <TableHead>Location</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Views</TableHead>
                                <TableHead>Clicks</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {banners?.map((banner) => (
                                <TableRow key={banner.id}>
                                    <TableCell className="font-medium">
                                        <div className="flex items-center gap-2">
                                            <Megaphone className="h-4 w-4 text-orange-500" />
                                            {banner.content}
                                        </div>
                                    </TableCell>
                                    <TableCell>Top Bar</TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <Switch
                                                checked={banner.isActive}
                                                onCheckedChange={(checked) => toggleStatusMutation.mutate({ id: banner.id, isActive: checked })}
                                            />
                                            <span className="text-xs text-muted-foreground">{banner.isActive ? 'Active' : 'Off'}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>{banner.viewCount}</TableCell>
                                    <TableCell>{banner.clickCount}</TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(banner.id)}>
                                            <Trash2 className="h-4 w-4 text-red-500" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {banners?.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                                        No banners created.
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

function BannerForm({ onSubmit }: { onSubmit: (data: any) => void }) {
    const [content, setContent] = useState("");
    const [linkUrl, setLinkUrl] = useState("");

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit({
            content,
            linkUrl,
            location: 'top-bar',
            isActive: true
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-2">
                <Label>Banner Text</Label>
                <Input
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="e.g. Summer Sale: 20% off all services!"
                    required
                />
            </div>
            <div className="grid gap-2">
                <Label>Link URL (Optional)</Label>
                <Input
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="/book-online"
                />
            </div>
            <div className="flex justify-end pt-4">
                <Button type="submit">Create Banner</Button>
            </div>
        </form>
    )
}
