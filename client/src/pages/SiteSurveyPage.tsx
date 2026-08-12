import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Camera, CheckCircle2, X, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import handyLogo from "@/assets/handy-logo-transparent.png";

/**
 * Contractor site-survey page.
 *
 * A contractor (e.g. Joe) opens this tokenised link on their phone at the
 * property and fills a per-item survey for the additional works — scope, rough
 * time, who's supplying materials, notes and photos. On submit it saves to the
 * quote row and pings the office (Pushover). Public, no auth — the slug is the
 * capability. Reuses the /api/pricing/quote-photos uploader and the
 * /api/personalized-quotes/:slug loader (for the customer header).
 */

// Fixed survey checklist for this job. Key persists with each item's response.
const SURVEY_ITEMS: { key: string; label: string }[] = [
    { key: "bathroom-1", label: "Bathroom (one) — decorate" },
    { key: "bathroom-2", label: "Bathroom (two) — decorate" },
    { key: "kitchen", label: "Kitchen — decorate" },
    { key: "small-bedroom-wall", label: "Small bedroom wall — strip, re-paper & paint" },
    { key: "back-room-ceiling", label: "Back room ceiling — repair" },
    { key: "banister", label: "Banister — paint (crack repair free)" },
    { key: "archway", label: "Archway above door — reshape" },
    { key: "bay-plaster-paper", label: "Wallpaper over 2 plaster sections" },
    { key: "waste", label: "Waste removal" },
];

type Materials = "us" | "her" | "";

interface ItemState {
    scope: string;
    timeEstimate: string;
    materials: Materials;
    notes: string;
    photoUrls: string[];
}

function emptyItem(): ItemState {
    return { scope: "", timeEstimate: "", materials: "", notes: "", photoUrls: [] };
}

export default function SiteSurveyPage() {
    const [, params] = useRoute("/survey/:slug");
    const slug = params?.slug;
    const { toast } = useToast();

    const { data: quote, isLoading, isError } = useQuery({
        queryKey: ["/api/personalized-quotes", slug],
        queryFn: async () => {
            const res = await fetch(`/api/personalized-quotes/${slug}`);
            if (!res.ok) throw new Error("Link invalid");
            return res.json();
        },
        enabled: !!slug,
    });

    const [items, setItems] = useState<Record<string, ItemState>>(() =>
        Object.fromEntries(SURVEY_ITEMS.map((i) => [i.key, emptyItem()])),
    );
    const [anythingElse, setAnythingElse] = useState("");
    const [surveyorName, setSurveyorName] = useState("");
    const [uploadingKey, setUploadingKey] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const patchItem = (key: string, patch: Partial<ItemState>) =>
        setItems((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

    const handlePhotoUpload = async (key: string, files: FileList | null) => {
        if (!files || files.length === 0) return;
        setUploadingKey(key);
        try {
            const formData = new FormData();
            Array.from(files).forEach((f) => formData.append("files", f));
            const res = await fetch("/api/pricing/quote-photos", { method: "POST", body: formData });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: "Upload failed" }));
                throw new Error(err.error || "Upload failed");
            }
            const data = await res.json();
            patchItem(key, { photoUrls: [...items[key].photoUrls, ...(data.urls || [])] });
        } catch (e) {
            toast({ title: "Photo upload failed", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
        } finally {
            setUploadingKey(null);
        }
    };

    const removePhoto = (key: string, url: string) =>
        patchItem(key, { photoUrls: items[key].photoUrls.filter((u) => u !== url) });

    const handleSubmit = async () => {
        setSubmitting(true);
        try {
            const payload = {
                items: SURVEY_ITEMS.map((i) => ({ key: i.key, ...items[i.key] })),
                anythingElse,
                surveyorName,
            };
            const res = await fetch(`/api/visit/${slug}/survey`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: "Submit failed" }));
                throw new Error(err.error || "Submit failed");
            }
            setSubmitted(true);
            window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (e) {
            toast({ title: "Couldn't submit survey", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
        } finally {
            setSubmitting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 text-slate-500 flex items-center justify-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" /> Loading survey…
            </div>
        );
    }

    if (isError || !quote) {
        return (
            <div className="min-h-screen bg-slate-50 text-slate-700 flex items-center justify-center p-10 text-center">
                This survey link is invalid or has expired.
            </div>
        );
    }

    if (submitted) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
                <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
                    <CheckCircle2 className="w-14 h-14 text-[#7DB00E] mx-auto mb-4" />
                    <h1 className="text-xl font-extrabold text-slate-900">Survey sent</h1>
                    <p className="text-slate-600 mt-2">
                        Thanks{surveyorName ? `, ${surveyorName.split(" ")[0]}` : ""}. The office has been notified and will
                        price up the works.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 font-sans pb-28">
            {/* Header */}
            <div className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-slate-200">
                <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-2">
                    <img src={handyLogo} alt="HandyServices" className="w-7 h-7 object-contain" />
                    <span className="text-slate-900 font-extrabold tracking-tight">
                        Handy<span className="text-[#7DB00E]">Services</span>
                    </span>
                    <span className="ml-auto text-xs font-semibold text-slate-500 uppercase tracking-wide">Site Survey</span>
                </div>
            </div>

            <div className="max-w-2xl mx-auto px-4 pt-5">
                {/* Customer / address context */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 mb-5">
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Job</div>
                    <div className="text-lg font-bold text-slate-900">{quote.customerName || "Customer"}</div>
                    {(quote.address || quote.postcode) && (
                        <div className="flex items-center gap-1 text-sm text-slate-500 mt-0.5">
                            <MapPin className="w-3.5 h-3.5" />
                            {[quote.address, quote.postcode].filter(Boolean).join(", ")}
                        </div>
                    )}
                    <p className="text-sm text-slate-500 mt-3">
                        Walk the property and fill in each item below — rough scope, a time estimate, who supplies the
                        materials, and a couple of photos. Skip anything not relevant.
                    </p>
                </div>

                {/* Item cards */}
                <div className="space-y-4">
                    {SURVEY_ITEMS.map((item, idx) => {
                        const st = items[item.key];
                        return (
                            <div key={item.key} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                                <div className="px-4 py-3 bg-slate-900 text-white flex items-center gap-2">
                                    <span className="text-xs font-bold bg-white/15 rounded-full w-6 h-6 flex items-center justify-center shrink-0">
                                        {idx + 1}
                                    </span>
                                    <span className="font-semibold text-sm leading-tight">{item.label}</span>
                                </div>
                                <div className="p-4 space-y-3">
                                    <div>
                                        <Label className="text-xs text-slate-500">Scope / what's involved</Label>
                                        <Textarea
                                            value={st.scope}
                                            onChange={(e) => patchItem(item.key, { scope: e.target.value })}
                                            placeholder="What needs doing here…"
                                            rows={2}
                                            className="mt-1"
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <Label className="text-xs text-slate-500">Time estimate</Label>
                                            <Input
                                                value={st.timeEstimate}
                                                onChange={(e) => patchItem(item.key, { timeEstimate: e.target.value })}
                                                placeholder="e.g. 1 day"
                                                className="mt-1"
                                            />
                                        </div>
                                        <div>
                                            <Label className="text-xs text-slate-500">Materials by</Label>
                                            <div className="mt-1 grid grid-cols-2 gap-1.5">
                                                <button
                                                    type="button"
                                                    onClick={() => patchItem(item.key, { materials: st.materials === "us" ? "" : "us" })}
                                                    className={`h-10 rounded-md text-sm font-semibold border transition ${
                                                        st.materials === "us"
                                                            ? "bg-[#7DB00E] text-white border-[#7DB00E]"
                                                            : "bg-white text-slate-600 border-slate-200"
                                                    }`}
                                                >
                                                    Us
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => patchItem(item.key, { materials: st.materials === "her" ? "" : "her" })}
                                                    className={`h-10 rounded-md text-sm font-semibold border transition ${
                                                        st.materials === "her"
                                                            ? "bg-[#7DB00E] text-white border-[#7DB00E]"
                                                            : "bg-white text-slate-600 border-slate-200"
                                                    }`}
                                                >
                                                    Client
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <Label className="text-xs text-slate-500">Material notes</Label>
                                        <Textarea
                                            value={st.notes}
                                            onChange={(e) => patchItem(item.key, { notes: e.target.value })}
                                            placeholder="Paint, paper, boards, fixings…"
                                            rows={2}
                                            className="mt-1"
                                        />
                                    </div>

                                    {/* Photos */}
                                    <div>
                                        <div className="flex flex-wrap gap-2">
                                            {st.photoUrls.map((url) => (
                                                <div key={url} className="relative w-16 h-16 rounded-md overflow-hidden border border-slate-200">
                                                    <img src={url} alt="survey" className="w-full h-full object-cover" />
                                                    <button
                                                        type="button"
                                                        onClick={() => removePhoto(item.key, url)}
                                                        className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5"
                                                    >
                                                        <X className="w-3 h-3 text-white" />
                                                    </button>
                                                </div>
                                            ))}
                                            <label className="w-16 h-16 rounded-md border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 cursor-pointer hover:border-[#7DB00E] hover:text-[#7DB00E]">
                                                {uploadingKey === item.key ? (
                                                    <Loader2 className="w-5 h-5 animate-spin" />
                                                ) : (
                                                    <Camera className="w-5 h-5" />
                                                )}
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    capture="environment"
                                                    multiple
                                                    className="hidden"
                                                    disabled={uploadingKey === item.key}
                                                    onChange={(e) => {
                                                        void handlePhotoUpload(item.key, e.target.files);
                                                        e.target.value = "";
                                                    }}
                                                />
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Anything else */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 mt-4">
                    <Label className="text-sm font-semibold text-slate-700">Anything else on site?</Label>
                    <Textarea
                        value={anythingElse}
                        onChange={(e) => setAnythingElse(e.target.value)}
                        placeholder="Extra works, access notes, risks, parking…"
                        rows={3}
                        className="mt-2"
                    />
                </div>

                {/* Your name */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 mt-4">
                    <Label className="text-sm font-semibold text-slate-700">Your name</Label>
                    <Input
                        value={surveyorName}
                        onChange={(e) => setSurveyorName(e.target.value)}
                        placeholder="Who carried out this survey"
                        className="mt-2"
                    />
                </div>
            </div>

            {/* Sticky submit */}
            <div className="fixed bottom-0 inset-x-0 z-50 bg-white/95 backdrop-blur border-t border-slate-200 px-4 py-3">
                <div className="max-w-2xl mx-auto">
                    <Button onClick={handleSubmit} disabled={submitting} className="w-full h-12 text-base bg-[#7DB00E] hover:bg-[#6a9a0c]">
                        {submitting ? (
                            <span className="flex items-center gap-2">
                                <Loader2 className="w-4 h-4 animate-spin" /> Sending…
                            </span>
                        ) : (
                            "Submit survey"
                        )}
                    </Button>
                </div>
            </div>
        </div>
    );
}
