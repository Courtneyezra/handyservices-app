import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Loader2, Save, RotateCcw, Plus, Trash2, Copy, Megaphone, Eye,
    Check, X, BarChart3, TrendingUp, MousePointerClick, Calendar,
    Shield, Wallet, Clock, Star, GripVertical, Users, CornerDownRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
    Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
    DEFAULT_PRICING_SETTINGS, QUOTE_OFFER_TEMPLATES, QUOTE_OFFER_CUSTOMER_TYPES,
    type PricingSettings, type QuoteOffer, type QuoteOffersConfig, type QuoteOfferGroup,
    type QuoteOfferType, type QuoteOfferTemplate, type QuoteOfferCustomerType,
} from "@shared/pricing-settings";

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem("adminToken");
    return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Default offer config — guards against a stored row that predates the field. */
const DEFAULT_OFFERS: QuoteOffersConfig = DEFAULT_PRICING_SETTINGS.quoteOffers;

const OFFER_TYPES: { id: QuoteOfferType; label: string }[] = [
    { id: "flex_date", label: "Flexible date (skip firm-date fee)" },
    { id: "add_task", label: "Add a task" },
    { id: "membership", label: "Membership" },
];

const BENEFIT_ICONS: { id: string; label: string; Icon: typeof Calendar }[] = [
    { id: "calendar", label: "Calendar", Icon: Calendar },
    { id: "shield", label: "Shield", Icon: Shield },
    { id: "wallet", label: "Wallet", Icon: Wallet },
    { id: "clock", label: "Clock", Icon: Clock },
    { id: "star", label: "Star", Icon: Star },
    { id: "check", label: "Check", Icon: Check },
];

/** Copy tokens resolved server-side at render — surfaced as an editor hint. */
const TOKENS = ["{savings}", "{base}", "{firm}", "{days}"];

/** Which customer-type "tab" is being edited. 'default' = the top-level group. */
type TypeKey = "default" | QuoteOfferCustomerType;

/** The editable core of an offer group (shared by default + per-type). */
type GroupShape = Pick<QuoteOfferGroup, "selectionMode" | "activeOfferId" | "items">;

const TYPE_LABELS: Record<TypeKey, string> = {
    default: "Default",
    homeowner: "Homeowner",
    landlord: "Landlord",
    property_manager: "Property Manager",
    tenant: "Tenant",
    business: "Business",
    letting_agent: "Letting Agent",
};

function slugifyId(name: string): string {
    const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const rand = Math.random().toString(36).slice(2, 6);
    return `${base || "offer"}_${rand}`;
}

function formatGBP(pence: number): string {
    return `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function blankOffer(): QuoteOffer {
    return {
        id: slugifyId("offer"),
        type: "flex_date",
        enabled: true,
        template: "dark_hero",
        name: "New offer",
        weight: 1,
        eyebrow: "One quick choice before your price",
        headline: "Stay flexible",
        subhead: "We pick the best day within {days} days — same fixed price.",
        benefits: [
            { icon: "calendar", text: "We find the best slot for you within {days} days" },
            { icon: "shield", text: "Same fixed price and workmanship guarantee" },
            { icon: "wallet", text: "Skip the {savings} firm date & time fee" },
        ],
        acceptLabel: "Save {savings} — I'm flexible",
        declineLabel: "No thanks, I need a specific day",
        finePrint: "Prefer a guaranteed date and arrival slot? Pick your exact day on the next screen for {firm}.",
        flexWithinDays: 7,
    };
}

// ── Performance report types ────────────────────────────────────────────────
interface OfferPerfRow {
    offerId: string;
    customerType: string | null;
    offerType: string | null;
    template: string | null;
    impressions: number;
    accepts: number;
    declines: number;
    acceptRatePercent: number;
    paid: number;
    bookingRatePercent: number;
    revenuePence: number;
    revenuePerImpressionPence: number;
}
interface OfferPerfResponse {
    period: { days: number; since: string };
    offers: OfferPerfRow[];
}

export default function QuoteOffersPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [config, setConfig] = useState<QuoteOffersConfig>(DEFAULT_OFFERS);
    const [initialized, setInitialized] = useState(false);
    const [editingType, setEditingType] = useState<TypeKey>("default");

    // Fetch full pricing settings (we only edit the quoteOffers slice).
    const { data: settings, isLoading } = useQuery<PricingSettings>({
        queryKey: ["pricingSettings"],
        queryFn: async () => {
            const res = await fetch("/api/settings/pricing", { headers: getAuthHeaders() });
            if (!res.ok) throw new Error("Failed to fetch pricing settings");
            return res.json();
        },
    });

    useEffect(() => {
        if (settings && !initialized) {
            // Defensive: a stored row may predate quoteOffers, or carry a partial
            // shape (getPricingSettings shallow-merges over defaults).
            const incoming = settings.quoteOffers ?? DEFAULT_OFFERS;
            setConfig({
                enabled: incoming.enabled ?? true,
                selectionMode: incoming.selectionMode ?? "manual",
                activeOfferId: incoming.activeOfferId,
                items: Array.isArray(incoming.items) ? incoming.items : [],
                perCustomerType: incoming.perCustomerType,
            });
            setInitialized(true);
        }
    }, [settings, initialized]);

    const saveMutation = useMutation({
        mutationFn: async (next: QuoteOffersConfig) => {
            const res = await fetch("/api/settings/pricing", {
                method: "PUT",
                headers: { "Content-Type": "application/json", ...getAuthHeaders() },
                body: JSON.stringify({ quoteOffers: next }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: "Save failed" }));
                throw new Error(err.error || (err.details ? err.details.join(", ") : "Failed to save"));
            }
            return res.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ["pricingSettings"] });
            toast({ title: "Offers saved", description: "The irresistible-offer config has been updated." });
            if (data.settings?.quoteOffers) setConfig(data.settings.quoteOffers);
        },
        onError: (error: Error) => {
            toast({ title: "Save failed", description: error.message, variant: "destructive" });
        },
    });

    // ── Per-type group resolution ─────────────────────────────────────────────
    const typeGroup: QuoteOfferGroup | undefined =
        editingType === "default" ? undefined : config.perCustomerType?.[editingType];
    const isCustomized = editingType !== "default" && !!typeGroup;
    const isSuppressed = !!typeGroup && typeGroup.enabled === false;

    // The group view the offer editor operates on (default → top-level config).
    const activeGroup: GroupShape =
        editingType === "default"
            ? { selectionMode: config.selectionMode, activeOfferId: config.activeOfferId, items: config.items }
            : {
                selectionMode: typeGroup?.selectionMode ?? "manual",
                activeOfferId: typeGroup?.activeOfferId,
                items: typeGroup?.items ?? [],
            };

    // ── Mutators ──────────────────────────────────────────────────────────────
    function patchConfig(patch: Partial<QuoteOffersConfig>) {
        setConfig(prev => ({ ...prev, ...patch }));
    }

    /** Write back to whichever group is being edited (default or per-type). */
    function updateActiveGroup(updater: (g: GroupShape) => GroupShape) {
        setConfig(prev => {
            if (editingType === "default") {
                const g = updater({ selectionMode: prev.selectionMode, activeOfferId: prev.activeOfferId, items: prev.items });
                return { ...prev, selectionMode: g.selectionMode, activeOfferId: g.activeOfferId, items: g.items };
            }
            const existing = prev.perCustomerType?.[editingType];
            const base: GroupShape = existing
                ? { selectionMode: existing.selectionMode, activeOfferId: existing.activeOfferId, items: existing.items }
                : { selectionMode: "manual", activeOfferId: undefined, items: [] };
            const g = updater(base);
            return {
                ...prev,
                perCustomerType: {
                    ...prev.perCustomerType,
                    [editingType]: { ...(existing ?? { enabled: true }), selectionMode: g.selectionMode, activeOfferId: g.activeOfferId, items: g.items },
                },
            };
        });
    }

    function patchGroupMeta(patch: Partial<GroupShape>) {
        updateActiveGroup(g => ({ ...g, ...patch }));
    }
    function patchOffer(index: number, patch: Partial<QuoteOffer>) {
        updateActiveGroup(g => ({ ...g, items: g.items.map((o, i) => (i === index ? { ...o, ...patch } : o)) }));
    }
    function addOffer() {
        updateActiveGroup(g => ({ ...g, items: [...g.items, blankOffer()] }));
    }
    function removeOffer(index: number) {
        updateActiveGroup(g => {
            const removed = g.items[index];
            const items = g.items.filter((_, i) => i !== index);
            const activeOfferId = g.activeOfferId === removed?.id ? items[0]?.id : g.activeOfferId;
            return { ...g, items, activeOfferId };
        });
    }
    function duplicateOffer(index: number) {
        updateActiveGroup(g => {
            const src = g.items[index];
            if (!src) return g;
            const copy: QuoteOffer = { ...src, id: slugifyId(src.name || "offer"), name: `${src.name || src.id} (copy)` };
            const items = [...g.items];
            items.splice(index + 1, 0, copy);
            return { ...g, items };
        });
    }
    function patchBenefit(oi: number, bi: number, patch: Partial<{ icon: string; text: string }>) {
        updateActiveGroup(g => ({
            ...g,
            items: g.items.map((o, i) => (i === oi ? { ...o, benefits: o.benefits.map((b, j) => (j === bi ? { ...b, ...patch } : b)) } : o)),
        }));
    }
    function addBenefit(oi: number) {
        updateActiveGroup(g => ({
            ...g,
            items: g.items.map((o, i) => (i === oi ? { ...o, benefits: [...o.benefits, { icon: "check", text: "" }] } : o)),
        }));
    }
    function removeBenefit(oi: number, bi: number) {
        updateActiveGroup(g => ({
            ...g,
            items: g.items.map((o, i) => (i === oi ? { ...o, benefits: o.benefits.filter((_, j) => j !== bi) } : o)),
        }));
    }

    // ── Per-type lifecycle ────────────────────────────────────────────────────
    function customizeType(seedFromDefault: boolean) {
        if (editingType === "default") return;
        setConfig(prev => ({
            ...prev,
            perCustomerType: {
                ...prev.perCustomerType,
                [editingType]: seedFromDefault
                    ? { enabled: true, selectionMode: prev.selectionMode, activeOfferId: prev.activeOfferId, items: prev.items.map(o => ({ ...o, benefits: o.benefits.map(b => ({ ...b })) })) }
                    : { enabled: true, selectionMode: "manual", activeOfferId: undefined, items: [blankOffer()] },
            },
        }));
    }
    function resetTypeToDefault() {
        if (editingType === "default") return;
        setConfig(prev => {
            const next = { ...(prev.perCustomerType ?? {}) };
            delete next[editingType as QuoteOfferCustomerType];
            return { ...prev, perCustomerType: Object.keys(next).length ? next : undefined };
        });
    }
    function setTypeSuppressed(suppress: boolean) {
        if (editingType === "default") return;
        setConfig(prev => {
            const existing = prev.perCustomerType?.[editingType] ?? { selectionMode: "manual" as const, activeOfferId: undefined, items: [] };
            return {
                ...prev,
                perCustomerType: { ...prev.perCustomerType, [editingType]: { ...existing, enabled: !suppress } },
            };
        });
    }

    function handleReset() {
        setConfig(DEFAULT_OFFERS);
        setEditingType("default");
        toast({ title: "Reset to defaults", description: "Offers populated with defaults. Click Save to apply." });
    }

    const enabledOffers = useMemo(() => activeGroup.items.filter(o => o.enabled), [activeGroup.items]);
    const showOfferEditor = editingType === "default" || (isCustomized && !isSuppressed);
    const editingLabel = TYPE_LABELS[editingType];

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <Megaphone className="w-6 h-6 text-primary" />
                        Quote Offers
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        The "irresistible offer" interstitial shown before the price (<code className="text-xs">?v=offer</code> flow).
                        Configure offers <strong>per customer type</strong> — run one offer now, A/B-test later — and track performance.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={handleReset} size="sm">
                        <RotateCcw className="w-4 h-4 mr-2" /> Reset
                    </Button>
                    <Button onClick={() => saveMutation.mutate(config)} disabled={saveMutation.isPending} size="sm">
                        {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                        Save Changes
                    </Button>
                </div>
            </div>

            <Tabs defaultValue="editor">
                <TabsList>
                    <TabsTrigger value="editor"><Megaphone className="w-4 h-4 mr-2" /> Editor</TabsTrigger>
                    <TabsTrigger value="performance"><BarChart3 className="w-4 h-4 mr-2" /> Performance</TabsTrigger>
                </TabsList>

                {/* ── EDITOR TAB ─────────────────────────────────────────────── */}
                <TabsContent value="editor" className="space-y-6 mt-4">
                    {/* Master switch + token legend */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Offer flow</CardTitle>
                            <CardDescription>Master switch for the interstitial across all customer types.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            <div className="flex items-center justify-between rounded-lg border p-3">
                                <div>
                                    <Label className="text-sm font-medium">Show the offer interstitial</Label>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        When off, the <code className="text-[11px]">?v=offer</code> flow skips straight to the quote for everyone.
                                    </p>
                                </div>
                                <Switch checked={config.enabled} onCheckedChange={(v) => patchConfig({ enabled: v })} />
                            </div>

                            {/* Token legend */}
                            <div className="rounded-lg border bg-muted/30 p-3">
                                <p className="text-xs font-medium mb-1.5">Copy tokens (resolved to live, server-authoritative numbers):</p>
                                <div className="flex flex-wrap gap-2">
                                    {TOKENS.map(t => (
                                        <code key={t} className="text-[11px] bg-background border rounded px-1.5 py-0.5">{t}</code>
                                    ))}
                                </div>
                                <p className="text-[11px] text-muted-foreground mt-1.5">
                                    {"{savings}"} = firm-date premium · {"{base}"} = flexible price · {"{firm}"} = firm price · {"{days}"} = flexible window
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Customer-type selector */}
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Users className="w-5 h-5 text-primary" /> Offers by customer type
                            </CardTitle>
                            <CardDescription>
                                Pick a customer type to configure its offers. Types without their own setup inherit <strong>Default</strong>.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-wrap gap-2">
                                <TypeChip
                                    label="Default"
                                    active={editingType === "default"}
                                    onClick={() => setEditingType("default")}
                                />
                                {QUOTE_OFFER_CUSTOMER_TYPES.map(t => {
                                    const g = config.perCustomerType?.[t.id];
                                    return (
                                        <TypeChip
                                            key={t.id}
                                            label={t.label}
                                            active={editingType === t.id}
                                            customized={!!g}
                                            suppressed={g?.enabled === false}
                                            onClick={() => setEditingType(t.id)}
                                        />
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Per-type lifecycle bar (only for non-default types) */}
                    {editingType !== "default" && (
                        isCustomized ? (
                            <Card>
                                <CardContent className="py-3 flex items-center justify-between gap-4 flex-wrap">
                                    <div className="flex items-center gap-3">
                                        <Switch checked={!isSuppressed} onCheckedChange={(v) => setTypeSuppressed(!v)} />
                                        <div>
                                            <Label className="text-sm font-medium">Show offers to {editingLabel} customers</Label>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                {isSuppressed
                                                    ? `${editingLabel} customers skip the interstitial and go straight to the price.`
                                                    : `${editingLabel} customers see this type's own offers below.`}
                                            </p>
                                        </div>
                                    </div>
                                    <Button variant="outline" size="sm" onClick={resetTypeToDefault}>
                                        <RotateCcw className="w-4 h-4 mr-2" /> Reset to Default
                                    </Button>
                                </CardContent>
                            </Card>
                        ) : (
                            <Card className="border-dashed">
                                <CardContent className="py-8 text-center space-y-3">
                                    <CornerDownRight className="w-6 h-6 mx-auto text-muted-foreground/50" />
                                    <p className="text-sm text-muted-foreground">
                                        <strong className="text-foreground">{editingLabel}</strong> customers currently see the <strong className="text-foreground">Default</strong> offers.
                                    </p>
                                    <div className="flex gap-2 justify-center flex-wrap">
                                        <Button size="sm" onClick={() => customizeType(false)}>
                                            <Plus className="w-4 h-4 mr-2" /> Customize for {editingLabel}
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={() => customizeType(true)}>
                                            <Copy className="w-4 h-4 mr-2" /> Copy Default as a starting point
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        )
                    )}

                    {/* Group editor (selection mode + offers) */}
                    {showOfferEditor && (
                        <>
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-base">
                                        {editingType === "default" ? "Default selection" : `${editingLabel} selection`}
                                    </CardTitle>
                                    <CardDescription>How the offer is chosen for {editingType === "default" ? "inheriting customer types" : `${editingLabel} customers`}.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label>Selection mode</Label>
                                            <Select
                                                value={activeGroup.selectionMode === "first" ? "manual" : activeGroup.selectionMode}
                                                onValueChange={(v) => patchGroupMeta({ selectionMode: v as GroupShape["selectionMode"] })}
                                            >
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="manual">Single offer (everyone sees one)</SelectItem>
                                                    <SelectItem value="weighted">A/B split (weighted by quote)</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <p className="text-xs text-muted-foreground">
                                                {activeGroup.selectionMode === "weighted"
                                                    ? "Each quote is deterministically bucketed across enabled offers — stable per quote."
                                                    : "Everyone in this group sees the one offer you pick."}
                                            </p>
                                        </div>

                                        {activeGroup.selectionMode !== "weighted" && (
                                            <div className="space-y-2">
                                                <Label>Active offer</Label>
                                                <Select
                                                    value={activeGroup.activeOfferId ?? enabledOffers[0]?.id ?? ""}
                                                    onValueChange={(v) => patchGroupMeta({ activeOfferId: v })}
                                                >
                                                    <SelectTrigger><SelectValue placeholder="Pick an offer" /></SelectTrigger>
                                                    <SelectContent>
                                                        {enabledOffers.length === 0 && (
                                                            <SelectItem value="" disabled>No enabled offers</SelectItem>
                                                        )}
                                                        {enabledOffers.map(o => (
                                                            <SelectItem key={o.id} value={o.id}>{o.name || o.id}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <p className="text-xs text-muted-foreground">Only enabled offers can be made active.</p>
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Offers list */}
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                                        {editingType === "default" ? "Default offers" : `${editingLabel} offers`} ({activeGroup.items.length})
                                    </h2>
                                    <Button variant="outline" size="sm" onClick={addOffer}>
                                        <Plus className="w-4 h-4 mr-2" /> Add offer
                                    </Button>
                                </div>

                                {activeGroup.items.length === 0 && (
                                    <Card className="border-dashed">
                                        <CardContent className="py-10 text-center text-sm text-muted-foreground">
                                            No offers yet. Click "Add offer" to create one.
                                        </CardContent>
                                    </Card>
                                )}

                                {activeGroup.items.map((offer, oi) => {
                                    const isActive = activeGroup.selectionMode !== "weighted" && activeGroup.activeOfferId === offer.id;
                                    return (
                                        <Card key={offer.id} className={isActive ? "border-primary/40 ring-1 ring-primary/20" : ""}>
                                            <CardHeader className="pb-3">
                                                <div className="flex items-start gap-3">
                                                    <GripVertical className="w-4 h-4 text-muted-foreground/40 mt-2.5 shrink-0" />
                                                    <div className="flex-1 min-w-0 space-y-1">
                                                        <Input
                                                            value={offer.name ?? ""}
                                                            onChange={(e) => patchOffer(oi, { name: e.target.value })}
                                                            placeholder="Offer name (admin only)"
                                                            className="font-semibold text-base h-9"
                                                        />
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <code className="text-[11px] text-muted-foreground">{offer.id}</code>
                                                            {isActive && <Badge className="text-[10px] h-5">LIVE</Badge>}
                                                            {activeGroup.selectionMode === "weighted" && offer.enabled && (
                                                                <Badge variant="secondary" className="text-[10px] h-5">in A/B</Badge>
                                                            )}
                                                            {!offer.enabled && <Badge variant="outline" className="text-[10px] h-5 text-muted-foreground">disabled</Badge>}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                        <div className="flex items-center gap-1.5 mr-1">
                                                            <span className="text-xs text-muted-foreground">On</span>
                                                            <Switch checked={offer.enabled} onCheckedChange={(v) => patchOffer(oi, { enabled: v })} />
                                                        </div>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Duplicate" onClick={() => duplicateOffer(oi)}>
                                                            <Copy className="w-4 h-4" />
                                                        </Button>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" title="Delete" onClick={() => removeOffer(oi)}>
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            </CardHeader>
                                            <CardContent className="space-y-4">
                                                {/* Row: template / type / weight / flexDays */}
                                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                                    <div className="space-y-1.5">
                                                        <Label className="text-xs">Design</Label>
                                                        <Select value={offer.template ?? "dark_hero"} onValueChange={(v) => patchOffer(oi, { template: v as QuoteOfferTemplate })}>
                                                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                                            <SelectContent>
                                                                {QUOTE_OFFER_TEMPLATES.map(t => (
                                                                    <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <Label className="text-xs">Type</Label>
                                                        <Select value={offer.type} onValueChange={(v) => patchOffer(oi, { type: v as QuoteOfferType })}>
                                                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                                            <SelectContent>
                                                                {OFFER_TYPES.map(t => (
                                                                    <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <Label className="text-xs">A/B weight</Label>
                                                        <Input
                                                            type="number" min={0} step={1} className="h-9"
                                                            value={offer.weight}
                                                            onChange={(e) => patchOffer(oi, { weight: Number(e.target.value) })}
                                                        />
                                                    </div>
                                                    {offer.type === "flex_date" && (
                                                        <div className="space-y-1.5">
                                                            <Label className="text-xs">Flexible days</Label>
                                                            <Input
                                                                type="number" min={1} step={1} className="h-9"
                                                                value={offer.flexWithinDays ?? 7}
                                                                onChange={(e) => patchOffer(oi, { flexWithinDays: Number(e.target.value) })}
                                                            />
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Copy fields */}
                                                <div className="space-y-3">
                                                    <div className="space-y-1.5">
                                                        <Label className="text-xs">Eyebrow</Label>
                                                        <Input value={offer.eyebrow ?? ""} onChange={(e) => patchOffer(oi, { eyebrow: e.target.value })} className="h-9" />
                                                    </div>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        <div className="space-y-1.5">
                                                            <Label className="text-xs">Headline</Label>
                                                            <Input value={offer.headline} onChange={(e) => patchOffer(oi, { headline: e.target.value })} className="h-9" />
                                                        </div>
                                                        <div className="space-y-1.5">
                                                            <Label className="text-xs">Sub-headline</Label>
                                                            <Input value={offer.subhead ?? ""} onChange={(e) => patchOffer(oi, { subhead: e.target.value })} className="h-9" />
                                                        </div>
                                                    </div>

                                                    {/* Benefits */}
                                                    <div className="space-y-2">
                                                        <div className="flex items-center justify-between">
                                                            <Label className="text-xs">Benefits</Label>
                                                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => addBenefit(oi)}>
                                                                <Plus className="w-3.5 h-3.5 mr-1" /> Add
                                                            </Button>
                                                        </div>
                                                        <div className="space-y-2">
                                                            {offer.benefits.map((b, bi) => (
                                                                <div key={bi} className="flex items-center gap-2">
                                                                    <Select value={b.icon} onValueChange={(v) => patchBenefit(oi, bi, { icon: v })}>
                                                                        <SelectTrigger className="h-9 w-32 shrink-0"><SelectValue /></SelectTrigger>
                                                                        <SelectContent>
                                                                            {BENEFIT_ICONS.map(({ id, label, Icon }) => (
                                                                                <SelectItem key={id} value={id}>
                                                                                    <span className="flex items-center gap-2"><Icon className="w-3.5 h-3.5" /> {label}</span>
                                                                                </SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                    <Input
                                                                        value={b.text}
                                                                        onChange={(e) => patchBenefit(oi, bi, { text: e.target.value })}
                                                                        placeholder="Benefit line"
                                                                        className="h-9 flex-1"
                                                                    />
                                                                    <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive shrink-0" onClick={() => removeBenefit(oi, bi)}>
                                                                        <X className="w-4 h-4" />
                                                                    </Button>
                                                                </div>
                                                            ))}
                                                            {offer.benefits.length === 0 && (
                                                                <p className="text-xs text-muted-foreground italic">No benefits — click "Add".</p>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        <div className="space-y-1.5">
                                                            <Label className="text-xs">Accept button</Label>
                                                            <Input value={offer.acceptLabel} onChange={(e) => patchOffer(oi, { acceptLabel: e.target.value })} className="h-9" />
                                                        </div>
                                                        <div className="space-y-1.5">
                                                            <Label className="text-xs">Decline button</Label>
                                                            <Input value={offer.declineLabel} onChange={(e) => patchOffer(oi, { declineLabel: e.target.value })} className="h-9" />
                                                        </div>
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <Label className="text-xs">Fine print</Label>
                                                        <Textarea value={offer.finePrint ?? ""} onChange={(e) => patchOffer(oi, { finePrint: e.target.value })} rows={2} />
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </TabsContent>

                {/* ── PERFORMANCE TAB ────────────────────────────────────────── */}
                <TabsContent value="performance" className="mt-4">
                    <OfferPerformanceReport config={config} />
                </TabsContent>
            </Tabs>
        </div>
    );
}

// ── Customer-type selector chip ──────────────────────────────────────────────
function TypeChip({ label, active, customized, suppressed, onClick }: {
    label: string; active: boolean; customized?: boolean; suppressed?: boolean; onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={[
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                active ? "border-primary bg-primary/10 text-primary font-medium" : "border-border hover:bg-muted text-foreground",
            ].join(" ")}
        >
            {customized && (
                <span
                    className={["inline-block w-1.5 h-1.5 rounded-full", suppressed ? "bg-muted-foreground" : "bg-primary"].join(" ")}
                    title={suppressed ? "Offers off for this type" : "Custom offers for this type"}
                />
            )}
            <span className={suppressed ? "line-through text-muted-foreground" : ""}>{label}</span>
        </button>
    );
}

// ── Performance report ──────────────────────────────────────────────────────
function OfferPerformanceReport({ config }: { config: QuoteOffersConfig }) {
    const [days, setDays] = useState(30);
    const [typeFilter, setTypeFilter] = useState<"all" | QuoteOfferCustomerType>("all");

    // Offer names can live in the default group or any per-type group.
    const nameById = useMemo(() => {
        const m = new Map<string, string>();
        for (const o of config.items) m.set(o.id, o.name || o.id);
        for (const g of Object.values(config.perCustomerType ?? {})) {
            for (const o of g?.items ?? []) m.set(o.id, o.name || o.id);
        }
        return m;
    }, [config]);

    const { data, isLoading, isError } = useQuery<OfferPerfResponse>({
        queryKey: ["offerPerformance", days],
        queryFn: async () => {
            const res = await fetch(`/api/analytics/quotes/offer-performance?days=${days}`, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error("Failed to fetch offer performance");
            return res.json();
        },
    });

    const rows = useMemo(() => {
        const all = data?.offers ?? [];
        return typeFilter === "all" ? all : all.filter(r => r.customerType === typeFilter);
    }, [data, typeFilter]);

    const totals = useMemo(() => {
        const impressions = rows.reduce((s, r) => s + r.impressions, 0);
        const accepts = rows.reduce((s, r) => s + r.accepts, 0);
        const paid = rows.reduce((s, r) => s + r.paid, 0);
        const revenuePence = rows.reduce((s, r) => s + r.revenuePence, 0);
        return { impressions, accepts, paid, revenuePence };
    }, [rows]);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm text-muted-foreground">
                    Funnel &amp; revenue per offer &amp; customer type. Bookings = quotes with a paid deposit; revenue = base price of those quotes.
                </p>
                <div className="flex items-center gap-2">
                    <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
                        <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All customer types</SelectItem>
                            {QUOTE_OFFER_CUSTOMER_TYPES.map(t => (
                                <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
                        <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="7">Last 7 days</SelectItem>
                            <SelectItem value="30">Last 30 days</SelectItem>
                            <SelectItem value="90">Last 90 days</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SummaryCard icon={Eye} label="Impressions" value={totals.impressions.toLocaleString()} />
                <SummaryCard icon={MousePointerClick} label="Accepts" value={totals.accepts.toLocaleString()}
                    sub={totals.impressions ? `${((totals.accepts / totals.impressions) * 100).toFixed(1)}% rate` : undefined} />
                <SummaryCard icon={Check} label="Bookings" value={totals.paid.toLocaleString()}
                    sub={totals.impressions ? `${((totals.paid / totals.impressions) * 100).toFixed(1)}% of views` : undefined} />
                <SummaryCard icon={TrendingUp} label="Revenue" value={formatGBP(totals.revenuePence)} />
            </div>

            <Card>
                <CardContent className="p-0">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-40">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : isError ? (
                        <div className="py-10 text-center text-sm text-destructive">Failed to load performance data.</div>
                    ) : rows.length === 0 ? (
                        <div className="py-10 text-center text-sm text-muted-foreground">
                            No offer events recorded in this window yet.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Offer</TableHead>
                                    <TableHead>Customer</TableHead>
                                    <TableHead className="text-right">Views</TableHead>
                                    <TableHead className="text-right">Accept</TableHead>
                                    <TableHead className="text-right">Decline</TableHead>
                                    <TableHead className="text-right">Accept %</TableHead>
                                    <TableHead className="text-right">Bookings</TableHead>
                                    <TableHead className="text-right">Book %</TableHead>
                                    <TableHead className="text-right">Revenue</TableHead>
                                    <TableHead className="text-right">£ / view</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map(row => (
                                    <TableRow key={`${row.offerId}::${row.customerType ?? "unknown"}`}>
                                        <TableCell>
                                            <div className="font-medium text-sm">{nameById.get(row.offerId) ?? row.offerId}</div>
                                            <div className="text-[11px] text-muted-foreground">
                                                {row.template ?? "—"} · <code>{row.offerId}</code>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-xs capitalize">{(row.customerType ?? "unknown").replace(/_/g, " ")}</span>
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">{row.impressions.toLocaleString()}</TableCell>
                                        <TableCell className="text-right tabular-nums">{row.accepts.toLocaleString()}</TableCell>
                                        <TableCell className="text-right tabular-nums">{row.declines.toLocaleString()}</TableCell>
                                        <TableCell className="text-right tabular-nums font-medium">{row.acceptRatePercent}%</TableCell>
                                        <TableCell className="text-right tabular-nums">{row.paid.toLocaleString()}</TableCell>
                                        <TableCell className="text-right tabular-nums">{row.bookingRatePercent}%</TableCell>
                                        <TableCell className="text-right tabular-nums font-medium">{formatGBP(row.revenuePence)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatGBP(row.revenuePerImpressionPence)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function SummaryCard({ icon: Icon, label, value, sub }: { icon: typeof Eye; label: string; value: string; sub?: string }) {
    return (
        <Card>
            <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                    <Icon className="w-4 h-4" />
                    <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
                </div>
                <div className="text-2xl font-bold mt-1.5 tabular-nums">{value}</div>
                {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
            </CardContent>
        </Card>
    );
}
