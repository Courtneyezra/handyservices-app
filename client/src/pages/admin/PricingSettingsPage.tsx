import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, RotateCcw, Percent, PoundSterling, Star, BadgeCheck, ChevronDown, ArrowDown, Shield, Zap, Brain, Ruler, Package, Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_PRICING_SETTINGS, type PricingSettings } from "@shared/pricing-settings";

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Convert pence integer to pounds string for display */
function penceToPounds(pence: number): string {
    return (pence / 100).toFixed(0);
}

/** Convert pounds string to pence integer for storage */
function poundsToPence(pounds: string): number {
    const val = parseFloat(pounds);
    return isNaN(val) ? 0 : Math.round(val * 100);
}

export default function PricingSettingsPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [form, setForm] = useState<PricingSettings>(DEFAULT_PRICING_SETTINGS);
    const [initialized, setInitialized] = useState(false);

    // Fetch current settings
    const { data: settings, isLoading } = useQuery<PricingSettings>({
        queryKey: ["pricingSettings"],
        queryFn: async () => {
            const res = await fetch("/api/settings/pricing", {
                headers: getAuthHeaders(),
            });
            if (!res.ok) throw new Error("Failed to fetch pricing settings");
            return res.json();
        },
    });

    // Populate form when data arrives
    useEffect(() => {
        if (settings && !initialized) {
            setForm(settings);
            setInitialized(true);
        }
    }, [settings, initialized]);

    // Save mutation
    const saveMutation = useMutation({
        mutationFn: async (data: PricingSettings) => {
            const res = await fetch("/api/settings/pricing", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    ...getAuthHeaders(),
                },
                body: JSON.stringify(data),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: "Save failed" }));
                throw new Error(err.error || "Failed to save pricing settings");
            }
            return res.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ["pricingSettings"] });
            toast({
                title: "Settings saved",
                description: "Pricing settings have been updated successfully.",
            });
            if (data.settings) {
                setForm(data.settings);
            }
        },
        onError: (error: Error) => {
            toast({
                title: "Save failed",
                description: error.message,
                variant: "destructive",
            });
        },
    });

    function handleSave() {
        saveMutation.mutate(form);
    }

    function handleReset() {
        setForm({ ...DEFAULT_PRICING_SETTINGS });
        toast({
            title: "Reset to defaults",
            description: "Form populated with default values. Click Save to apply.",
        });
    }

    function updateField<K extends keyof PricingSettings>(key: K, value: PricingSettings[K]) {
        setForm(prev => ({ ...prev, [key]: value }));
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {/* Page Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Pricing Settings</h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        Configure margins, booking rules, and social proof displayed on quotes.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={handleReset} size="sm">
                        <RotateCcw className="w-4 h-4 mr-2" />
                        Reset to Defaults
                    </Button>
                    <Button onClick={handleSave} disabled={saveMutation.isPending} size="sm">
                        {saveMutation.isPending ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                            <Save className="w-4 h-4 mr-2" />
                        )}
                        Save Changes
                    </Button>
                </div>
            </div>

            {/* Pricing Model Diagram */}
            <Card className="border-primary/20 bg-primary/[0.02]">
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg">How Pricing Works — EVE + Contextual</CardTitle>
                    <CardDescription>
                        Price = Market Reference + Differentiator Value, constrained by guardrails
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {/* Layer 1 */}
                    <div className="rounded-lg border bg-card p-3">
                        <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <Ruler className="w-4 h-4 text-blue-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-mono text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded">LAYER 1</span>
                                    <span className="font-semibold text-sm">Market Anchor</span>
                                    <span className="text-xs text-muted-foreground ml-auto">Deterministic</span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                    24 job categories with Nottingham market rates (Checkatrade, TaskRabbit). Each has hourly rate + minimum charge.
                                </p>
                                <p className="text-xs font-mono text-muted-foreground mt-1">
                                    Reference = max(hourly_rate × hours, minimum_charge)
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-center"><ArrowDown className="w-4 h-4 text-muted-foreground" /></div>

                    {/* Layer 3 */}
                    <div className="rounded-lg border bg-card p-3">
                        <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <Brain className="w-4 h-4 text-purple-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-mono text-purple-500 bg-purple-500/10 px-1.5 py-0.5 rounded">LAYER 3</span>
                                    <span className="font-semibold text-sm">Contextual Value</span>
                                    <span className="text-xs text-muted-foreground ml-auto">AI (GPT-4o-mini)</span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Adjusts reference price based on 6 real-time signals:
                                </p>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 mt-2">
                                    <span className="text-xs"><span className="text-orange-400">▲</span> Emergency: +30-50%</span>
                                    <span className="text-xs"><span className="text-orange-400">▲</span> Priority: +10-20%</span>
                                    <span className="text-xs"><span className="text-orange-400">▲</span> After hrs/wknd: +15-25%</span>
                                    <span className="text-xs"><span className="text-green-400">▼</span> Returning cust: -5-10%</span>
                                    <span className="text-xs"><span className="text-green-400">▼</span> Batch (2+ jobs): -5-15%</span>
                                    <span className="text-xs"><span className="text-blue-400">+</span> Materials: +{form.materialsMarginPercent}% markup</span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-2 italic">
                                    Also generates: headline, value bullets, WhatsApp message
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-center"><ArrowDown className="w-4 h-4 text-muted-foreground" /></div>

                    {/* Layer 4 */}
                    <div className="rounded-lg border bg-card p-3">
                        <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <Shield className="w-4 h-4 text-red-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-mono text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded">LAYER 4</span>
                                    <span className="font-semibold text-sm">Guardrails</span>
                                    <span className="text-xs text-muted-foreground ml-auto">Deterministic</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-2">
                                    <span className="text-xs">Floor: ≥ market rate × hours</span>
                                    <span className="text-xs">Minimum: ≥ callout fee (£45-70)</span>
                                    <span className="text-xs">Ceiling: ≤ 3× rate (4× emergency)</span>
                                    <span className="text-xs font-medium">Floor rate: ≥ £{penceToPounds(form.minMarginPencePerHour)}/hr ✦</span>
                                    <span className="text-xs">Returning cap: ≤ prev avg × 1.15</span>
                                    <span className="text-xs">Psychological: ends in 9</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-center"><ArrowDown className="w-4 h-4 text-muted-foreground" /></div>

                    {/* Final Price */}
                    <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3">
                        <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <Receipt className="w-4 h-4 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold text-sm">Final Quote</span>
                                </div>
                                <p className="text-xs font-mono text-muted-foreground mt-1">
                                    (Labour - batch discount) + (Materials × {(1 + form.materialsMarginPercent / 100).toFixed(2)}) → ends in 9
                                </p>
                                <div className="flex flex-wrap gap-3 mt-2">
                                    <span className="text-xs bg-muted px-2 py-0.5 rounded">Deposit: {form.depositPercent}% ✦</span>
                                    <span className="text-xs bg-muted px-2 py-0.5 rounded">Pay-in-full: -{form.payInFullDiscountPercent}% ✦</span>
                                    <span className="text-xs bg-muted px-2 py-0.5 rounded">Batch cap: {form.maxBatchDiscountPercent}% max ✦</span>
                                </div>
                                <p className="text-[10px] text-muted-foreground mt-2">✦ Configurable below</p>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Section 1: Margins & Deposits */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Percent className="w-5 h-5 text-primary" />
                        Margins & Deposits
                    </CardTitle>
                    <CardDescription>
                        Control markup on materials and deposit/payment terms.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                        <Label htmlFor="materialsMargin">Materials Margin %</Label>
                        <Input
                            id="materialsMargin"
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={form.materialsMarginPercent}
                            onChange={(e) => updateField("materialsMarginPercent", Number(e.target.value))}
                        />
                        <p className="text-xs text-muted-foreground">Markup on materials cost price</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="depositPercent">Deposit %</Label>
                        <Input
                            id="depositPercent"
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={form.depositPercent}
                            onChange={(e) => updateField("depositPercent", Number(e.target.value))}
                        />
                        <p className="text-xs text-muted-foreground">Percentage taken as deposit on booking</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="payInFullDiscount">Pay-in-Full Discount %</Label>
                        <Input
                            id="payInFullDiscount"
                            type="number"
                            min={0}
                            max={20}
                            step={0.5}
                            value={form.payInFullDiscountPercent}
                            onChange={(e) => updateField("payInFullDiscountPercent", Number(e.target.value))}
                        />
                        <p className="text-xs text-muted-foreground">Discount for paying the full amount upfront</p>
                    </div>
                </CardContent>
            </Card>

            {/* Section 2: Booking Rules */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <PoundSterling className="w-5 h-5 text-primary" />
                        Booking Rules
                    </CardTitle>
                    <CardDescription>
                        Pricing adjustments for urgency, flexibility, batching, and deposit thresholds.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <Label htmlFor="flexibleDiscount">Flexible Discount %</Label>
                        <Input
                            id="flexibleDiscount"
                            type="number"
                            min={0}
                            max={50}
                            step={1}
                            value={form.flexibleDiscountPercent}
                            onChange={(e) => updateField("flexibleDiscountPercent", Number(e.target.value))}
                        />
                        <p className="text-xs text-muted-foreground">Discount when customer chooses flexible scheduling</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="urgentPremium">Urgent Premium %</Label>
                        <Input
                            id="urgentPremium"
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={form.urgentPremiumPercent}
                            onChange={(e) => updateField("urgentPremiumPercent", Number(e.target.value))}
                        />
                        <p className="text-xs text-muted-foreground">Premium charged for urgent/same-day jobs</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="depositThreshold">Deposit Split Threshold</Label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                            <Input
                                id="depositThreshold"
                                type="number"
                                min={0}
                                step={1}
                                className="pl-7"
                                value={penceToPounds(form.depositSplitThresholdPence)}
                                onChange={(e) => updateField("depositSplitThresholdPence", poundsToPence(e.target.value))}
                            />
                        </div>
                        <p className="text-xs text-muted-foreground">Jobs above this amount offer deposit + balance split</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="maxBatchDiscount">Max Batch Discount %</Label>
                        <Input
                            id="maxBatchDiscount"
                            type="number"
                            min={0}
                            max={50}
                            step={1}
                            value={form.maxBatchDiscountPercent}
                            onChange={(e) => updateField("maxBatchDiscountPercent", Number(e.target.value))}
                        />
                        <p className="text-xs text-muted-foreground">Maximum discount for multi-line quotes</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="minMarginPerHour">Floor Rate Per Hour</Label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                            <Input
                                id="minMarginPerHour"
                                type="number"
                                min={0}
                                step={1}
                                className="pl-7"
                                value={penceToPounds(form.minMarginPencePerHour)}
                                onChange={(e) => updateField("minMarginPencePerHour", poundsToPence(e.target.value))}
                            />
                        </div>
                        <p className="text-xs text-muted-foreground">No quote will ever go below this hourly rate</p>
                    </div>
                </CardContent>
            </Card>

            {/* Section 3: Social Proof */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Star className="w-5 h-5 text-primary" />
                        Social Proof
                    </CardTitle>
                    <CardDescription>
                        Trust signals displayed on quotes and landing pages.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <Label htmlFor="googleRating">Google Rating</Label>
                        <Input
                            id="googleRating"
                            type="text"
                            value={form.googleRating}
                            onChange={(e) => updateField("googleRating", e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">e.g. "4.9"</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="reviewCount">Review Count</Label>
                        <Input
                            id="reviewCount"
                            type="number"
                            min={0}
                            value={form.reviewCount}
                            onChange={(e) => updateField("reviewCount", Number(e.target.value))}
                        />
                        <p className="text-xs text-muted-foreground">Number of Google reviews</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="propertiesServed">Properties / Landlords Served</Label>
                        <Input
                            id="propertiesServed"
                            type="text"
                            value={form.propertiesServed}
                            onChange={(e) => updateField("propertiesServed", e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">e.g. "230+"</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="jobsCompleted">Jobs Completed</Label>
                        <Input
                            id="jobsCompleted"
                            type="text"
                            value={form.jobsCompleted}
                            onChange={(e) => updateField("jobsCompleted", e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">e.g. "500+"</p>
                    </div>
                </CardContent>
            </Card>

            {/* Current Values Preview */}
            <Card className="border-dashed">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <BadgeCheck className="w-5 h-5 text-green-500" />
                        Trust Strip Preview
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                            <span className="font-semibold text-foreground">£2M</span> Insured
                        </span>
                        <span className="text-border">|</span>
                        <span className="flex items-center gap-1">
                            <span className="font-semibold text-foreground">{form.googleRating}</span>
                            <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                            Google ({form.reviewCount} reviews)
                        </span>
                        <span className="text-border">|</span>
                        <span>
                            <span className="font-semibold text-foreground">{form.propertiesServed}</span> properties serviced
                        </span>
                        <span className="text-border">|</span>
                        <span>
                            <span className="font-semibold text-foreground">{form.jobsCompleted}</span> jobs completed
                        </span>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
