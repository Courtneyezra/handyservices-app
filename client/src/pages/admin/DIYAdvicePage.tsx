/**
 * DIY Advice Manager
 *
 * Admin page for managing DIY troubleshooting advice shown to tenants.
 * Two tabs: Advice Entries (CRUD) and Unsafe Patterns (safety gate).
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
    Lightbulb, Plus, Pencil, Trash2, Search, ShieldAlert,
    ChevronDown, ChevronUp, Eye, EyeOff, X, AlertTriangle
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Table, TableBody, TableCell, TableHead,
    TableHeader, TableRow
} from "@/components/ui/table";
import {
    Dialog, DialogContent, DialogFooter, DialogHeader,
    DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem,
    SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ISSUE_CATEGORIES = [
    "plumbing", "plumbing_emergency", "electrical", "electrical_emergency",
    "heating", "carpentry", "locksmith", "security", "water_leak",
    "appliance", "cosmetic", "upgrade", "pest_control", "cleaning",
    "garden", "general", "other"
];

interface DIYAdvice {
    id: string;
    name: string;
    category: string | null;
    keywords: string[];
    descriptionPatterns: string[] | null;
    canDIY: boolean;
    steps: string[];
    toolsNeeded: string[] | null;
    warning: string | null;
    priority: number | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

interface UnsafePattern {
    id: string;
    pattern: string;
    isRegex: boolean;
    warningMessage: string | null;
    isActive: boolean;
    createdAt: string;
}

const getAdminToken = () => localStorage.getItem("adminToken") || "";

export default function DIYAdvicePage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [searchTerm, setSearchTerm] = useState("");
    const [activeTab, setActiveTab] = useState("advice");

    // Advice dialog state
    const [adviceDialogOpen, setAdviceDialogOpen] = useState(false);
    const [editingAdvice, setEditingAdvice] = useState<DIYAdvice | null>(null);
    const [previewOpen, setPreviewOpen] = useState<string | null>(null);

    // Pattern dialog state
    const [patternDialogOpen, setPatternDialogOpen] = useState(false);
    const [editingPattern, setEditingPattern] = useState<UnsafePattern | null>(null);

    // ==========================================
    // Queries
    // ==========================================

    const { data: adviceEntries = [], isLoading: adviceLoading } = useQuery<DIYAdvice[]>({
        queryKey: ["diy-advice"],
        queryFn: async () => {
            const res = await fetch("/api/admin/diy-advice", {
                headers: { Authorization: `Bearer ${getAdminToken()}` }
            });
            if (!res.ok) throw new Error("Failed to fetch");
            return res.json();
        },
    });

    const { data: unsafePatternsList = [], isLoading: patternsLoading } = useQuery<UnsafePattern[]>({
        queryKey: ["unsafe-patterns"],
        queryFn: async () => {
            const res = await fetch("/api/admin/diy-advice/unsafe-patterns", {
                headers: { Authorization: `Bearer ${getAdminToken()}` }
            });
            if (!res.ok) throw new Error("Failed to fetch");
            return res.json();
        },
    });

    // ==========================================
    // Mutations
    // ==========================================

    const createAdvice = useMutation({
        mutationFn: async (data: Record<string, unknown>) => {
            const res = await fetch("/api/admin/diy-advice", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAdminToken()}` },
                body: JSON.stringify(data),
            });
            if (!res.ok) throw new Error((await res.json()).error);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["diy-advice"] });
            toast({ title: "Advice created" });
            setAdviceDialogOpen(false);
        },
        onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    });

    const updateAdvice = useMutation({
        mutationFn: async ({ id, ...data }: Record<string, unknown> & { id: string }) => {
            const res = await fetch(`/api/admin/diy-advice/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAdminToken()}` },
                body: JSON.stringify(data),
            });
            if (!res.ok) throw new Error((await res.json()).error);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["diy-advice"] });
            toast({ title: "Advice updated" });
            setAdviceDialogOpen(false);
            setEditingAdvice(null);
        },
        onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    });

    const deleteAdvice = useMutation({
        mutationFn: async (id: string) => {
            const res = await fetch(`/api/admin/diy-advice/${id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${getAdminToken()}` },
            });
            if (!res.ok) throw new Error("Failed to delete");
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["diy-advice"] });
            toast({ title: "Advice deleted" });
        },
    });

    const toggleAdvice = useMutation({
        mutationFn: async (id: string) => {
            const res = await fetch(`/api/admin/diy-advice/${id}/toggle`, {
                method: "PATCH",
                headers: { Authorization: `Bearer ${getAdminToken()}` },
            });
            if (!res.ok) throw new Error("Failed to toggle");
            return res.json();
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["diy-advice"] }),
    });

    const createPattern = useMutation({
        mutationFn: async (data: Record<string, unknown>) => {
            const res = await fetch("/api/admin/diy-advice/unsafe-patterns", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAdminToken()}` },
                body: JSON.stringify(data),
            });
            if (!res.ok) throw new Error((await res.json()).error);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["unsafe-patterns"] });
            toast({ title: "Unsafe pattern created" });
            setPatternDialogOpen(false);
        },
        onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    });

    const updatePattern = useMutation({
        mutationFn: async ({ id, ...data }: Record<string, unknown> & { id: string }) => {
            const res = await fetch(`/api/admin/diy-advice/unsafe-patterns/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAdminToken()}` },
                body: JSON.stringify(data),
            });
            if (!res.ok) throw new Error((await res.json()).error);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["unsafe-patterns"] });
            toast({ title: "Pattern updated" });
            setPatternDialogOpen(false);
            setEditingPattern(null);
        },
        onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    });

    const deletePattern = useMutation({
        mutationFn: async (id: string) => {
            const res = await fetch(`/api/admin/diy-advice/unsafe-patterns/${id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${getAdminToken()}` },
            });
            if (!res.ok) throw new Error("Failed to delete");
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["unsafe-patterns"] });
            toast({ title: "Pattern deleted" });
        },
    });

    // ==========================================
    // Filtering
    // ==========================================

    const filteredAdvice = adviceEntries.filter(a =>
        a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.keywords.some(k => k.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (a.category && a.category.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const filteredPatterns = unsafePatternsList.filter(p =>
        p.pattern.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // ==========================================
    // Render
    // ==========================================

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Lightbulb className="w-6 h-6 text-amber-500" />
                        DIY Advice Manager
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        Manage DIY troubleshooting advice shown to tenants via WhatsApp
                    </p>
                </div>
                <div className="flex gap-2">
                    <Badge variant="outline" className="text-sm">
                        {adviceEntries.filter(a => a.isActive).length} active entries
                    </Badge>
                    <Badge variant="outline" className="text-sm text-red-500 border-red-300">
                        <ShieldAlert className="w-3 h-3 mr-1" />
                        {unsafePatternsList.filter(p => p.isActive).length} safety patterns
                    </Badge>
                </div>
            </div>

            {/* Search + Add */}
            <div className="flex gap-4 items-center">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by name, keyword, or category..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                    />
                </div>
                {activeTab === "advice" ? (
                    <Button onClick={() => { setEditingAdvice(null); setAdviceDialogOpen(true); }}>
                        <Plus className="w-4 h-4 mr-2" /> Add Advice
                    </Button>
                ) : (
                    <Button onClick={() => { setEditingPattern(null); setPatternDialogOpen(true); }} variant="destructive">
                        <ShieldAlert className="w-4 h-4 mr-2" /> Add Unsafe Pattern
                    </Button>
                )}
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                    <TabsTrigger value="advice" className="gap-2">
                        <Lightbulb className="w-4 h-4" /> Advice Entries ({adviceEntries.length})
                    </TabsTrigger>
                    <TabsTrigger value="patterns" className="gap-2">
                        <ShieldAlert className="w-4 h-4" /> Unsafe Patterns ({unsafePatternsList.length})
                    </TabsTrigger>
                </TabsList>

                {/* Advice Tab */}
                <TabsContent value="advice">
                    <Card>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Category</TableHead>
                                        <TableHead>Keywords</TableHead>
                                        <TableHead className="text-center">Steps</TableHead>
                                        <TableHead className="text-center">DIY?</TableHead>
                                        <TableHead className="text-center">Active</TableHead>
                                        <TableHead className="text-center">Priority</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {adviceLoading ? (
                                        <TableRow>
                                            <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                                                Loading...
                                            </TableCell>
                                        </TableRow>
                                    ) : filteredAdvice.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                                                No advice entries found
                                            </TableCell>
                                        </TableRow>
                                    ) : filteredAdvice.map((entry) => (
                                        <TableRow key={entry.id} className={!entry.isActive ? "opacity-50" : ""}>
                                            <TableCell className="font-medium">{entry.name}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="text-xs">
                                                    {entry.category || "none"}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-wrap gap-1">
                                                    {entry.keywords.slice(0, 3).map((k, i) => (
                                                        <Badge key={i} variant="secondary" className="text-xs">{k}</Badge>
                                                    ))}
                                                    {entry.keywords.length > 3 && (
                                                        <Badge variant="secondary" className="text-xs">+{entry.keywords.length - 3}</Badge>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-center">{entry.steps.length}</TableCell>
                                            <TableCell className="text-center">
                                                {entry.canDIY ? (
                                                    <Badge className="bg-green-500 text-white text-xs">Yes</Badge>
                                                ) : (
                                                    <Badge variant="destructive" className="text-xs">No</Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <Switch
                                                    checked={entry.isActive}
                                                    onCheckedChange={() => toggleAdvice.mutate(entry.id)}
                                                />
                                            </TableCell>
                                            <TableCell className="text-center text-muted-foreground">
                                                {entry.priority ?? 0}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex gap-1 justify-end">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => setPreviewOpen(previewOpen === entry.id ? null : entry.id)}
                                                        title="Preview"
                                                    >
                                                        {previewOpen === entry.id ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => { setEditingAdvice(entry); setAdviceDialogOpen(true); }}
                                                        title="Edit"
                                                    >
                                                        <Pencil className="w-4 h-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="text-destructive"
                                                        onClick={() => {
                                                            if (confirm(`Delete "${entry.name}"?`)) {
                                                                deleteAdvice.mutate(entry.id);
                                                            }
                                                        }}
                                                        title="Delete"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>

                            {/* Preview Panel */}
                            {previewOpen && (
                                <div className="border-t p-6 bg-muted/30">
                                    <AdvicePreview entry={filteredAdvice.find(a => a.id === previewOpen)!} />
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Unsafe Patterns Tab */}
                <TabsContent value="patterns">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-red-600">
                                <AlertTriangle className="w-5 h-5" />
                                Safety Gate Patterns
                            </CardTitle>
                            <p className="text-sm text-muted-foreground">
                                These patterns block DIY advice. If a tenant's description matches any active pattern,
                                they'll be told to wait for a professional.
                            </p>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Pattern</TableHead>
                                        <TableHead>Type</TableHead>
                                        <TableHead>Custom Warning</TableHead>
                                        <TableHead className="text-center">Active</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {patternsLoading ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                                Loading...
                                            </TableCell>
                                        </TableRow>
                                    ) : filteredPatterns.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                                No patterns found
                                            </TableCell>
                                        </TableRow>
                                    ) : filteredPatterns.map((pattern) => (
                                        <TableRow key={pattern.id} className={!pattern.isActive ? "opacity-50" : ""}>
                                            <TableCell className="font-mono font-medium">{pattern.pattern}</TableCell>
                                            <TableCell>
                                                <Badge variant={pattern.isRegex ? "outline" : "secondary"} className="text-xs">
                                                    {pattern.isRegex ? "Regex" : "Keyword"}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                                                {pattern.warningMessage || "Default warning"}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <Switch
                                                    checked={pattern.isActive}
                                                    onCheckedChange={() => updatePattern.mutate({
                                                        id: pattern.id,
                                                        isActive: !pattern.isActive
                                                    })}
                                                />
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex gap-1 justify-end">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => { setEditingPattern(pattern); setPatternDialogOpen(true); }}
                                                    >
                                                        <Pencil className="w-4 h-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="text-destructive"
                                                        onClick={() => {
                                                            if (confirm(`Delete pattern "${pattern.pattern}"?`)) {
                                                                deletePattern.mutate(pattern.id);
                                                            }
                                                        }}
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Advice Form Dialog */}
            <AdviceDialog
                open={adviceDialogOpen}
                onOpenChange={(open) => { setAdviceDialogOpen(open); if (!open) setEditingAdvice(null); }}
                editing={editingAdvice}
                onSubmit={(data) => {
                    if (editingAdvice) {
                        updateAdvice.mutate({ id: editingAdvice.id, ...data });
                    } else {
                        createAdvice.mutate(data);
                    }
                }}
                isLoading={createAdvice.isPending || updateAdvice.isPending}
            />

            {/* Pattern Form Dialog */}
            <PatternDialog
                open={patternDialogOpen}
                onOpenChange={(open) => { setPatternDialogOpen(open); if (!open) setEditingPattern(null); }}
                editing={editingPattern}
                onSubmit={(data) => {
                    if (editingPattern) {
                        updatePattern.mutate({ id: editingPattern.id, ...data });
                    } else {
                        createPattern.mutate(data);
                    }
                }}
                isLoading={createPattern.isPending || updatePattern.isPending}
            />
        </div>
    );
}

// ==========================================
// Advice Preview Component
// ==========================================

function AdvicePreview({ entry }: { entry: DIYAdvice }) {
    if (!entry) return null;

    return (
        <div className="max-w-lg">
            <h3 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">
                Tenant sees this:
            </h3>
            <div className="bg-background border rounded-lg p-4 space-y-3">
                {entry.canDIY ? (
                    <>
                        <p className="font-medium">Here are some steps you can try:</p>
                        <ol className="list-decimal list-inside space-y-1 text-sm">
                            {entry.steps.map((step, i) => (
                                <li key={i}>{step}</li>
                            ))}
                        </ol>
                        {entry.toolsNeeded && entry.toolsNeeded.length > 0 && (
                            <div className="text-sm">
                                <p className="font-medium mt-2">Tools you'll need:</p>
                                <ul className="list-disc list-inside">
                                    {entry.toolsNeeded.map((tool, i) => (
                                        <li key={i}>{tool}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </>
                ) : (
                    <p className="text-amber-600 font-medium">
                        This requires a professional assessment.
                    </p>
                )}
                {entry.warning && (
                    <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded p-3 text-sm">
                        <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                        <span>{entry.warning}</span>
                    </div>
                )}
            </div>
        </div>
    );
}

// ==========================================
// Advice Form Dialog
// ==========================================

function AdviceDialog({
    open, onOpenChange, editing, onSubmit, isLoading
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    editing: DIYAdvice | null;
    onSubmit: (data: Record<string, unknown>) => void;
    isLoading: boolean;
}) {
    const [name, setName] = useState("");
    const [category, setCategory] = useState<string>("");
    const [keywords, setKeywords] = useState("");
    const [descPatterns, setDescPatterns] = useState("");
    const [canDIY, setCanDIY] = useState(true);
    const [steps, setSteps] = useState<string[]>([""]);
    const [toolsNeeded, setToolsNeeded] = useState("");
    const [warning, setWarning] = useState("");
    const [priority, setPriority] = useState(0);

    // Reset form when dialog opens
    const handleOpenChange = (isOpen: boolean) => {
        if (isOpen) {
            if (editing) {
                setName(editing.name);
                setCategory(editing.category || "");
                setKeywords(editing.keywords.join(", "));
                setDescPatterns(editing.descriptionPatterns?.join(", ") || "");
                setCanDIY(editing.canDIY);
                setSteps(editing.steps.length > 0 ? editing.steps : [""]);
                setToolsNeeded(editing.toolsNeeded?.join(", ") || "");
                setWarning(editing.warning || "");
                setPriority(editing.priority ?? 0);
            } else {
                setName("");
                setCategory("");
                setKeywords("");
                setDescPatterns("");
                setCanDIY(true);
                setSteps([""]);
                setToolsNeeded("");
                setWarning("");
                setPriority(0);
            }
        }
        onOpenChange(isOpen);
    };

    const handleSubmit = () => {
        const data: Record<string, unknown> = {
            name,
            category: category || null,
            keywords: keywords.split(",").map(k => k.trim()).filter(Boolean),
            descriptionPatterns: descPatterns ? descPatterns.split(",").map(p => p.trim()).filter(Boolean) : null,
            canDIY,
            steps: steps.filter(s => s.trim()),
            toolsNeeded: toolsNeeded ? toolsNeeded.split(",").map(t => t.trim()).filter(Boolean) : null,
            warning: warning || null,
            priority,
        };
        onSubmit(data);
    };

    const addStep = () => setSteps([...steps, ""]);
    const removeStep = (idx: number) => setSteps(steps.filter((_, i) => i !== idx));
    const updateStep = (idx: number, val: string) => setSteps(steps.map((s, i) => i === idx ? val : s));
    const moveStep = (idx: number, dir: -1 | 1) => {
        const newSteps = [...steps];
        const target = idx + dir;
        if (target < 0 || target >= newSteps.length) return;
        [newSteps[idx], newSteps[target]] = [newSteps[target], newSteps[idx]];
        setSteps(newSteps);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{editing ? "Edit" : "Add"} DIY Advice</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Name + Category row */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label>Name *</Label>
                            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Dripping Tap" />
                        </div>
                        <div>
                            <Label>Category</Label>
                            <Select value={category} onValueChange={setCategory}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select category" />
                                </SelectTrigger>
                                <SelectContent>
                                    {ISSUE_CATEGORIES.map(cat => (
                                        <SelectItem key={cat} value={cat}>{cat.replace(/_/g, " ")}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Keywords + Description Patterns */}
                    <div>
                        <Label>Keywords * (comma-separated)</Label>
                        <Input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="tap, drip, dripping" />
                        <p className="text-xs text-muted-foreground mt-1">Matched against the issue type AND description</p>
                    </div>
                    <div>
                        <Label>Description Patterns (comma-separated)</Label>
                        <Input value={descPatterns} onChange={e => setDescPatterns(e.target.value)} placeholder="dripping, leaking" />
                        <p className="text-xs text-muted-foreground mt-1">Additional patterns matched against the description only. If set, both keywords AND patterns must match.</p>
                    </div>

                    {/* Can DIY + Priority */}
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                            <Switch checked={canDIY} onCheckedChange={setCanDIY} />
                            <Label>Can DIY (tenant can fix themselves)</Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Label>Priority</Label>
                            <Input
                                type="number"
                                className="w-20"
                                value={priority}
                                onChange={e => setPriority(parseInt(e.target.value) || 0)}
                            />
                        </div>
                    </div>

                    {/* Steps */}
                    <div>
                        <Label className="mb-2 block">Steps * (ordered list)</Label>
                        <div className="space-y-2">
                            {steps.map((step, idx) => (
                                <div key={idx} className="flex gap-2 items-start">
                                    <span className="text-sm text-muted-foreground pt-2 w-6 shrink-0">{idx + 1}.</span>
                                    <Textarea
                                        value={step}
                                        onChange={e => updateStep(idx, e.target.value)}
                                        placeholder={`Step ${idx + 1}`}
                                        rows={1}
                                        className="flex-1 min-h-[38px]"
                                    />
                                    <div className="flex flex-col gap-0.5">
                                        <Button variant="ghost" size="sm" className="h-5 px-1" onClick={() => moveStep(idx, -1)} disabled={idx === 0}>
                                            <ChevronUp className="w-3 h-3" />
                                        </Button>
                                        <Button variant="ghost" size="sm" className="h-5 px-1" onClick={() => moveStep(idx, 1)} disabled={idx === steps.length - 1}>
                                            <ChevronDown className="w-3 h-3" />
                                        </Button>
                                    </div>
                                    {steps.length > 1 && (
                                        <Button variant="ghost" size="sm" className="text-destructive h-8" onClick={() => removeStep(idx)}>
                                            <X className="w-3 h-3" />
                                        </Button>
                                    )}
                                </div>
                            ))}
                        </div>
                        <Button variant="outline" size="sm" className="mt-2" onClick={addStep}>
                            <Plus className="w-3 h-3 mr-1" /> Add Step
                        </Button>
                    </div>

                    {/* Tools + Warning */}
                    <div>
                        <Label>Tools Needed (comma-separated)</Label>
                        <Input value={toolsNeeded} onChange={e => setToolsNeeded(e.target.value)} placeholder="Adjustable wrench, Plunger" />
                    </div>
                    <div>
                        <Label>Warning Message (optional)</Label>
                        <Textarea value={warning} onChange={e => setWarning(e.target.value)} placeholder="Safety warning shown to tenant..." rows={2} />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSubmit} disabled={isLoading || !name || !keywords || steps.filter(s => s.trim()).length === 0}>
                        {isLoading ? "Saving..." : editing ? "Update" : "Create"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ==========================================
// Pattern Form Dialog
// ==========================================

function PatternDialog({
    open, onOpenChange, editing, onSubmit, isLoading
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    editing: UnsafePattern | null;
    onSubmit: (data: Record<string, unknown>) => void;
    isLoading: boolean;
}) {
    const [pattern, setPattern] = useState("");
    const [isRegex, setIsRegex] = useState(false);
    const [warningMessage, setWarningMessage] = useState("");
    const [regexError, setRegexError] = useState("");

    const handleOpenChange = (isOpen: boolean) => {
        if (isOpen) {
            if (editing) {
                setPattern(editing.pattern);
                setIsRegex(editing.isRegex);
                setWarningMessage(editing.warningMessage || "");
            } else {
                setPattern("");
                setIsRegex(false);
                setWarningMessage("");
            }
            setRegexError("");
        }
        onOpenChange(isOpen);
    };

    const validateRegex = (val: string) => {
        if (!isRegex) { setRegexError(""); return; }
        try {
            new RegExp(val, 'i');
            setRegexError("");
        } catch (e: any) {
            setRegexError(e.message);
        }
    };

    const handleSubmit = () => {
        onSubmit({
            pattern,
            isRegex,
            warningMessage: warningMessage || null,
        });
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>{editing ? "Edit" : "Add"} Unsafe Pattern</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div>
                        <Label>Pattern *</Label>
                        <Input
                            value={pattern}
                            onChange={e => { setPattern(e.target.value); validateRegex(e.target.value); }}
                            placeholder={isRegex ? "e.g. ceiling.*(collapse|fall)" : "e.g. gas"}
                            className={regexError ? "border-red-500" : ""}
                        />
                        {regexError && <p className="text-xs text-red-500 mt-1">{regexError}</p>}
                        <p className="text-xs text-muted-foreground mt-1">
                            {isRegex
                                ? "Regular expression matched against tenant's description"
                                : "Simple keyword — blocks if description contains this word"
                            }
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        <Switch checked={isRegex} onCheckedChange={(v) => { setIsRegex(v); validateRegex(pattern); }} />
                        <Label>Regex pattern (advanced)</Label>
                    </div>

                    <div>
                        <Label>Custom Warning Message (optional)</Label>
                        <Textarea
                            value={warningMessage}
                            onChange={e => setWarningMessage(e.target.value)}
                            placeholder="Leave blank for default: 'This requires a professional...'"
                            rows={2}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSubmit} disabled={isLoading || !pattern || !!regexError}>
                        {isLoading ? "Saving..." : editing ? "Update" : "Create"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
