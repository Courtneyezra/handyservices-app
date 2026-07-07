import { useState } from "react";
import { Loader2, Stethoscope, Copy, Check, ExternalLink, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * Visit Link generator — the daily driver for sending a customer an upfront-paid
 * diagnostic visit link (an expert visits on-site and produces a fixed quote).
 *
 * Quote links are generated separately on the "New Quote" (contextual) page, so
 * this surface is deliberately visit-only. It posts to the shared
 * /api/personalized-quotes/value endpoint with selectedRoute: 'assessment'
 * (consultation) + single fixed-fee mode, and lands the customer on /visit/:slug.
 */
export default function SendPage() {
    const { toast } = useToast();

    const [customerName, setCustomerName] = useState("");
    const [phone, setPhone] = useState("");
    const [postcode, setPostcode] = useState("");
    const [address, setAddress] = useState("");
    const [fee, setFee] = useState(""); // £, string for the input
    const [note, setNote] = useState("");
    const [clientType, setClientType] = useState<"residential" | "commercial">("residential");

    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const feeNum = parseFloat(fee);
    const feeValid = !isNaN(feeNum) && feeNum > 0;
    const canSubmit = customerName.trim() && phone.trim() && postcode.trim() && feeValid;

    const resetResult = () => {
        setGeneratedUrl(null);
        setCopied(false);
    };

    const handleGenerate = async () => {
        if (!canSubmit) {
            toast({
                title: "Missing details",
                description: "Name, phone, postcode and a valid fee are required.",
                variant: "destructive",
            });
            return;
        }

        setIsGenerating(true);
        resetResult();

        // jobDescription must be >= 10 chars on the server — fall back to a
        // descriptive default when the optional reason is short or empty.
        const trimmedNote = note.trim();
        const fallbackDesc = `Diagnostic visit for ${customerName.trim()} at ${postcode.trim()}`;
        const jobDescription = trimmedNote.length >= 10 ? trimmedNote : fallbackDesc;

        const body: Record<string, any> = {
            jobDescription,
            baseJobPrice: Math.round(feeNum * 100), // pence
            urgencyReason: "med",
            ownershipContext: "homeowner",
            desiredTimeframe: "flex",
            customerName: customerName.trim(),
            phone: phone.trim(),
            postcode: postcode.trim(),
            address: address.trim() || undefined,
            clientType,
            selectedRoute: "assessment", // → quoteMode 'consultation'
            visitTierMode: "standard", // single fixed fee, not tiers
            ...(trimmedNote ? { assessmentReason: trimmedNote } : {}),
        };

        try {
            const adminToken = localStorage.getItem("adminToken");
            const res = await fetch("/api/personalized-quotes/value", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
                },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ message: "Unknown error" }));
                throw new Error(err.message || "Failed to create link");
            }

            const data = await res.json();
            setGeneratedUrl(`${window.location.origin}/visit/${data.shortSlug}`);
            toast({ title: "Link ready", description: "Visit link created." });
        } catch (e: any) {
            toast({ title: "Error", description: e?.message || "Failed to create link", variant: "destructive" });
        } finally {
            setIsGenerating(false);
        }
    };

    const handleCopy = async () => {
        if (!generatedUrl) return;
        await navigator.clipboard.writeText(generatedUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
    };

    const whatsappHref = generatedUrl
        ? `https://wa.me/?text=${encodeURIComponent(
              `Hi ${customerName.trim()}, here's your visit booking link: ${generatedUrl}`
          )}`
        : "#";

    return (
        <div className="max-w-2xl mx-auto px-4 py-8">
            <div className="mb-6">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Stethoscope className="w-6 h-6 text-primary" /> Send a visit link
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Create an upfront-paid diagnostic visit link — an expert visits on-site and gives a fixed quote.
                    (For a priced proposal, use <span className="font-medium">New Quote</span> instead.)
                </p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Customer details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="name">Name</Label>
                            <Input id="name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Jane Smith" />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="phone">Phone</Label>
                            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07700 900123" />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="postcode">Postcode</Label>
                            <Input id="postcode" value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder="NG1 1AA" />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="fee">Diagnostic fee (£)</Label>
                            <Input id="fee" type="number" min="0" step="1" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="39" />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="address">Address <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="12 High Street, Nottingham" />
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="note">
                            Reason for visit <span className="text-muted-foreground font-normal">(optional)</span>
                        </Label>
                        <Textarea
                            id="note"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            rows={3}
                            placeholder="Leaking under the kitchen sink, wants it looked at before quoting…"
                        />
                        <p className="text-xs text-muted-foreground">Shown to the customer on the visit page.</p>
                    </div>

                    {/* Client type */}
                    <div className="flex gap-2">
                        {(["residential", "commercial"] as const).map((ct) => (
                            <button
                                key={ct}
                                type="button"
                                onClick={() => setClientType(ct)}
                                className={cn(
                                    "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors capitalize",
                                    clientType === ct
                                        ? "border-primary bg-primary/10 text-primary"
                                        : "border-border text-muted-foreground hover:border-muted-foreground/40"
                                )}
                            >
                                {ct}
                            </button>
                        ))}
                    </div>

                    <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800">
                        The fee is presented as <strong>100% credited to the job</strong> if the customer goes ahead.
                        On payment, the visit is held against an available slot and lands on the dispatch schedule.
                    </div>

                    <Button onClick={handleGenerate} disabled={isGenerating || !canSubmit} className="w-full" size="lg">
                        {isGenerating ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating link…</>
                        ) : (
                            <>Create visit link</>
                        )}
                    </Button>
                </CardContent>
            </Card>

            {/* Result */}
            {generatedUrl && (
                <Card className="mt-4 border-primary/40">
                    <CardContent className="pt-6 space-y-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-emerald-600">
                            <Check className="w-4 h-4" /> Visit link ready to send
                        </div>
                        <div className="flex items-center gap-2">
                            <Input readOnly value={generatedUrl} className="font-mono text-xs" />
                            <Button variant="outline" size="icon" onClick={handleCopy} title="Copy">
                                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                            </Button>
                        </div>
                        <div className="flex gap-2">
                            <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="flex-1">
                                <Button variant="outline" className="w-full gap-2">
                                    <MessageCircle className="w-4 h-4" /> WhatsApp
                                </Button>
                            </a>
                            <a href={generatedUrl} target="_blank" rel="noopener noreferrer" className="flex-1">
                                <Button variant="outline" className="w-full gap-2">
                                    <ExternalLink className="w-4 h-4" /> Preview
                                </Button>
                            </a>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
