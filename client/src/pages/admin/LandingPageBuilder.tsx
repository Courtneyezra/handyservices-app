
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { apiRequest } from "../../lib/queryClient";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { Label } from "../../components/ui/label";
import { Slider } from "../../components/ui/slider";
import { Plus, Save, Trash2, ArrowLeft, ExternalLink, RefreshCw, Smartphone, Monitor, Info } from "lucide-react";

import { useToast } from "../../hooks/use-toast";
import { Switch } from "../../components/ui/switch";
import { IntakeHero } from "../../components/IntakeHero";

interface AdminLandingPageBuilderProps {
    pageId?: string | number;
}

export default function AdminLandingPageBuilder({ pageId }: AdminLandingPageBuilderProps) {
    const { id: paramId } = useParams();
    const id = pageId ? pageId.toString() : paramId;

    const [_, setLocation] = useLocation();
    const queryClient = useQueryClient();
    const { toast } = useToast();

    // Fetch Page Data including Variants
    const { data: page, isLoading } = useQuery({
        queryKey: ["admin-landing-page", id],
        queryFn: async () => {
            // ... (keep existing comment or logic, mostly unused relying on list below)
            return null;
        },
        enabled: false
    });

    // Workaround: Get from list
    const { data: pages } = useQuery<any[]>({
        queryKey: ["admin-landing-pages"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/landing-pages");
            return res.json();
        }
    });

    const currentPage = pages?.find(p => p.id === parseInt(id!));
    const [activeTab, setActiveTab] = useState<string>("");

    // Initialize active tab when data loads
    if (currentPage && !activeTab && currentPage.variants?.length > 0) {
        setActiveTab(currentPage.variants[0].id.toString());
    }

    const updateVariantMutation = useMutation({
        mutationFn: async (vars: { id: number, data: any }) => {
            const res = await apiRequest("PATCH", `/api/variants/${vars.id}`, vars.data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["admin-landing-pages"] });
            toast({ title: "Saved", description: "Variant updated successfully." });
        }
    });

    const updatePageMutation = useMutation({
        mutationFn: async (data: any) => {
            const res = await apiRequest("PATCH", `/api/landing-pages/${id}`, data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["admin-landing-pages"] });
            toast({ title: "Updated", description: "Page settings updated." });
        }
    });

    const createVariantMutation = useMutation({
        mutationFn: async () => {
            const name = prompt("Name for new variant (e.g. Variant B):");
            if (!name) return;

            // Clone content from first variant or default
            const baseContent = currentPage?.variants[0]?.content || {};

            const res = await apiRequest("POST", `/api/landing-pages/${id}/variants`, {
                name,
                weight: 0, // Start inactive
                content: baseContent
            });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["admin-landing-pages"] });
        }
    });

    const deleteVariantMutation = useMutation({
        mutationFn: async (variantId: number) => {
            if (!confirm("Are you sure? This action cannot be undone.")) return;
            await apiRequest("DELETE", `/api/variants/${variantId}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["admin-landing-pages"] });
        }
    });


    if (!currentPage) return <div className="p-8">Loading...</div>;

    const activeVariant = currentPage.variants.find((v: any) => v.id.toString() === activeTab);

    const handleContentChange = (field: string, value: string) => {
        if (!activeVariant) return;
        // Optimistic UI updates could be tricky here with react-query, 
        // normally we'd use local state form.
        // For simplicity let's use a "Save" button approach with local state buffer?
        // Or just let user type and we push? 
        // Better: Make a sub-component for the form.
    };

    return (
        <div className="p-8 max-w-7xl mx-auto pb-32">
            <div className="flex items-center gap-4 mb-8">
                <Button variant="ghost" size="icon" onClick={() => setLocation("/admin/landing-pages")}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold">{currentPage.name}</h1>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                        <code>{currentPage.slug === 'landing' || currentPage.slug === 'derby' ? `/${currentPage.slug}` : `/l/${currentPage.slug}`}</code>
                        <a href={currentPage.slug === 'landing' || currentPage.slug === 'derby' ? `/${currentPage.slug}` : `/l/${currentPage.slug}`} target="_blank" className="hover:text-primary">
                            <ExternalLink className="h-3 w-3 inline" />
                        </a>
                    </div>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                <div className="flex justify-between items-center">
                    <TabsList>
                        {currentPage.variants.map((v: any) => (
                            <TabsTrigger key={v.id} value={v.id.toString()} className="flex gap-2">
                                {v.name}
                                <span className="text-xs bg-muted-foreground/20 px-1 rounded">
                                    {v.weight}%
                                </span>
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => createVariantMutation.mutate()}>
                            <Plus className="h-4 w-4 mr-2" />
                            Add Variant
                        </Button>
                        <Button onClick={() => window.location.reload()} variant="ghost" size="icon">
                            <RefreshCw className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                <div className="flex items-center space-x-2 bg-slate-50 p-4 rounded-lg border mb-4">
                    <Switch
                        id="auto-optimize"
                        checked={currentPage.optimizationMode === 'auto'}
                        onCheckedChange={(checked) => updatePageMutation.mutate({ optimizationMode: checked ? 'auto' : 'manual' })}
                    />
                    <Label htmlFor="auto-optimize" className="flex flex-col cursor-pointer">
                        <span className="font-semibold">Auto-Optimization (AI)</span>
                        <span className="text-xs text-muted-foreground font-normal">
                            {currentPage.optimizationMode === 'auto'
                                ? "System automatically routes traffic to the winning variant (Thompson Sampling)."
                                : "Manual Control. You set the traffic weights manually below."}
                        </span>
                    </Label>
                </div>

                {currentPage.variants.map((variant: any) => (
                    <TabsContent key={variant.id} value={variant.id.toString()}>
                        <VariantEditor
                            variant={variant}
                            onSave={(data: any) => updateVariantMutation.mutate({ id: variant.id, data })}
                            onDelete={() => deleteVariantMutation.mutate(variant.id)}
                            isOnly={currentPage.variants.length === 1}
                        />
                    </TabsContent>
                ))}
            </Tabs>
        </div>
    );
}


// Helper component for Iframe Preview
const PreviewFrame = ({ children, title, className, style }: any) => {
    const mountNode = useRef<HTMLDivElement | null>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        if (iframeRef.current) {
            setMounted(true);
            // Copy styles from main document to iframe
            const doc = iframeRef.current.contentDocument;
            if (doc && doc.head.children.length === 0) {
                // Basic resets
                const baseStyle = doc.createElement('style');
                baseStyle.innerHTML = `
                body { margin: 0; padding: 0; overflow-x: hidden; } 
                * { box-sizing: border-box; }
            `;
                doc.head.appendChild(baseStyle);

                // Copy all styles (Tailwind etc)
                Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).forEach((link) => {
                    doc.head.appendChild(link.cloneNode(true));
                });
            }
        }
    }, []);

    return (
        <iframe
            title={title}
            className={className}
            style={style}
            ref={iframeRef}
        >
            {mounted && iframeRef.current?.contentDocument?.body &&
                createPortal(
                    <div className="h-full w-full bg-slate-50">
                        {children}
                    </div>,
                    iframeRef.current.contentDocument.body
                )
            }
        </iframe>
    );
};

function VariantEditor({ variant, onSave, onDelete, isOnly }: any) {
    // Local state for form
    const [formData, setFormData] = useState(variant);
    const [hasChanges, setHasChanges] = useState(false);

    // View Mode State
    const [viewMode, setViewMode] = useState<'mobile' | 'desktop'>('mobile');

    const updateContent = (field: string, value: string) => {
        setFormData((prev: any) => ({
            ...prev,
            content: {
                ...prev.content,
                [field]: value
            }
        }));
        setHasChanges(true);
    };

    const updateField = (field: string, value: any) => {
        setFormData((prev: any) => ({ ...prev, [field]: value }));
        setHasChanges(true);
    };

    const handleSave = () => {
        onSave({
            content: formData.content,
            weight: formData.weight,
            name: formData.name
        });
        setHasChanges(false);
    }

    const stats = {
        views: variant.viewCount || 0,
        conversions: variant.conversionCount || 0,
        rate: variant.viewCount > 0 ? ((variant.conversionCount / variant.viewCount) * 100).toFixed(1) : "0.0"
    };

    return (
        <div className="space-y-8">
            {/* Stats Bar */}
            <div className="grid grid-cols-3 gap-4">
                <Card>
                    <CardContent className="pt-6 text-center">
                        <div className="text-2xl font-bold">{stats.views}</div>
                        <div className="text-xs text-muted-foreground uppercase tracking-wide mt-1">Total Views</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 text-center">
                        <div className="text-2xl font-bold">{stats.conversions}</div>
                        <div className="text-xs text-muted-foreground uppercase tracking-wide mt-1">Conversions</div>
                    </CardContent>
                </Card>
                <Card className={Number(stats.rate) > 10 ? "border-green-500 bg-green-50/10" : ""}>
                    <CardContent className="pt-6 text-center">
                        <div className="text-2xl font-bold text-green-600">{stats.rate}%</div>
                        <div className="text-xs text-muted-foreground uppercase tracking-wide mt-1">Conversion Rate</div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                {/* Visual Preview (Real Component) - Left Side */}
                <div className="xl:col-span-1 space-y-4">
                    {/* View Mode Toggles */}
                    <div className="flex justify-center gap-2 mb-4">
                        <Button
                            variant={viewMode === 'mobile' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setViewMode('mobile')}
                            className="gap-2"
                        >
                            <Smartphone className="w-4 h-4" />
                            Mobile
                        </Button>
                        <Button
                            variant={viewMode === 'desktop' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setViewMode('desktop')}
                            className="gap-2"
                        >
                            <Monitor className="w-4 h-4" />
                            Desktop
                        </Button>
                    </div>

                    <div className={`transition-all duration-300 mx-auto relative bg-background shadow-xl overflow-hidden ${viewMode === 'mobile'
                        ? "border-[8px] border-slate-900 rounded-[2.5rem] max-w-[375px] h-[667px]"
                        : "border rounded-lg aspect-video w-full max-w-[500px]" // Desktop visual container size (fits in column)
                        }`}>
                        {/* Iframe for Isolated Viewport */}
                        <PreviewFrame
                            title="Preview"
                            className="border-none bg-white origin-top-left transition-all duration-300"
                            style={viewMode === 'mobile'
                                ? { width: '100%', height: '100%' }
                                : { width: '1280px', height: '720px', transform: 'scale(0.39)' } // 1280 * 0.39 ~= 500px
                            }
                        >
                            <IntakeHero
                                location="Nottingham"
                                headline={formData.content.heroHeadline}
                                subhead={formData.content.heroSubhead}
                                ctaText={formData.content.ctaText}
                                mobileCtaText={formData.content.mobileCtaText}
                                desktopCtaText={formData.content.desktopCtaText}
                                bannerText={formData.content.bannerText}
                                heroImage={formData.content.heroImage}
                            />
                        </PreviewFrame>

                        {/* Phone Notch Mockup (Mobile Only) */}
                        {viewMode === 'mobile' && (
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-slate-900 rounded-b-xl z-10 pointer-events-none"></div>
                        )}

                        {/* Overlay Label */}
                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center justify-center bg-black/5 opacity-0 hover:opacity-100 transition-opacity pointer-events-none z-20">
                            <span className="bg-white/80 backdrop-blur text-xs px-2 py-1 rounded shadow">Live Iframe Preview</span>
                        </div>
                    </div>
                    <p className="text-xs text-center text-muted-foreground">Previewing as "Nottingham"</p>
                </div>

                {/* Editor Form - Right Side */}
                <div className="xl:col-span-2 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Content Editor</CardTitle>
                            <CardDescription>Edit the content for this variant.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-2">
                                <Label>Hero Headline</Label>
                                <Input
                                    value={formData.content.heroHeadline || ""}
                                    onChange={(e) => updateContent("heroHeadline", e.target.value)}
                                    placeholder="{{location}}||Handyman Service||Next-day slots • Fast & reliable"
                                />
                                <p className="text-xs text-muted-foreground">
                                    💡 Use <code className="bg-muted px-1 py-0.5 rounded">||</code> to create multi-tier headlines.
                                    Format: <code className="bg-muted px-1 py-0.5 rounded">Line 1||Line 2||Line 3</code>
                                </p>
                            </div>

                            <div className="grid gap-2">
                                <Label>Hero Subheadline</Label>
                                <Textarea
                                    value={formData.content.heroSubhead || ""}
                                    onChange={(e) => updateContent("heroSubhead", e.target.value)}
                                />
                            </div>

                            <div className="grid gap-2">
                                <Label>CTA Text (Button)</Label>
                                <Input
                                    value={formData.content.ctaText || ""}
                                    onChange={(e) => updateContent("ctaText", e.target.value)}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label className="flex items-center gap-2">
                                        <Smartphone className="w-3 h-3" />
                                        Mobile CTA
                                    </Label>
                                    <Input
                                        placeholder="Same as default"
                                        value={formData.content.mobileCtaText || ""}
                                        onChange={(e) => updateContent("mobileCtaText", e.target.value)}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label className="flex items-center gap-2">
                                        <Monitor className="w-3 h-3" />
                                        Desktop CTA
                                    </Label>
                                    <Input
                                        placeholder="Same as default"
                                        value={formData.content.desktopCtaText || ""}
                                        onChange={(e) => updateContent("desktopCtaText", e.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="grid gap-2">
                                <Label className="flex items-center gap-2">
                                    <Info className="w-3 h-3" />
                                    Page Banner
                                </Label>
                                <Input
                                    placeholder="Enter banner text (HTML allowed)"
                                    value={formData.content.bannerText || ""}
                                    onChange={(e) => updateContent("bannerText", e.target.value)}
                                />
                            </div>

                            <div className="grid gap-2">
                                <Label>Hero Image URL</Label>
                                <Input
                                    value={formData.content.heroImage || ""}
                                    onChange={(e) => updateContent("heroImage", e.target.value)}
                                    placeholder="https://..."
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Configuration</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-4">
                                <div className="flex justify-between">
                                    <Label>Traffic Weight ({formData.weight}%)</Label>
                                    <span className="text-xs text-muted-foreground">Probability of showing this variant</span>
                                </div>
                                <Slider
                                    value={[formData.weight]}
                                    max={100}
                                    step={5}
                                    onValueChange={(vals) => updateField("weight", vals[0])}
                                />
                            </div>

                            <div className="flex gap-2 justify-end pt-4">
                                {!isOnly && (
                                    <Button variant="destructive" size="sm" onClick={onDelete}>
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        Delete Variant
                                    </Button>
                                )}
                                <Button onClick={handleSave} disabled={!hasChanges}>
                                    <Save className="h-4 w-4 mr-2" />
                                    Save Changes
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

