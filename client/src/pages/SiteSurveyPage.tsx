import { useRef, useState } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Camera, CheckCircle2, X, MapPin, Mic, Square, Video, Plus, FileText } from "lucide-react";
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
 * property and captures each additional-works item. VOICE NOTES and VIDEO are
 * the primary capture: the tradesman presses record, talks through the item,
 * and on stop the note is uploaded + auto-transcribed (Whisper) so the office
 * gets readable text without anyone typing. Video is a one-tap camera capture.
 * Typed scope/notes are demoted behind an optional toggle. Quick structured
 * fields (time estimate, who supplies materials) stay inline. On submit it
 * saves to the quote row and pings the office (Pushover). Public, no auth — the
 * slug is the capability. Reuses /api/pricing/quote-videos for video,
 * /api/pricing/survey-audio for voice notes, and /api/personalized-quotes/:slug
 * for the customer header.
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
    voiceNoteUrl?: string;
    transcript?: string;
    videoUrls: string[];
}

function emptyItem(): ItemState {
    return { scope: "", timeEstimate: "", materials: "", notes: "", photoUrls: [], videoUrls: [] };
}

// Pick a MediaRecorder mime type the browser actually supports. mobile Safari
// emits audio/mp4; Chrome/Android emit audio/webm. Whisper handles both.
function pickAudioMime(): string {
    const MR = (typeof window !== "undefined" && (window as any).MediaRecorder) as typeof MediaRecorder | undefined;
    if (!MR || typeof MR.isTypeSupported !== "function") return "";
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"];
    for (const c of candidates) {
        if (MR.isTypeSupported(c)) return c;
    }
    return "";
}

function extForMime(mime: string): string {
    if (mime.includes("mp4")) return "mp4";
    if (mime.includes("mpeg")) return "mp3";
    return "webm";
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
    const [uploadingVideoKey, setUploadingVideoKey] = useState<string | null>(null);
    const [recordingKey, setRecordingKey] = useState<string | null>(null);
    const [transcribingKey, setTranscribingKey] = useState<string | null>(null);
    const [micBlocked, setMicBlocked] = useState<Set<string>>(new Set());
    const [showText, setShowText] = useState<Set<string>>(new Set());
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    // MediaRecorder plumbing (single active recorder — one item at a time).
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);

    const patchItem = (key: string, patch: Partial<ItemState>) =>
        setItems((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

    const toggleText = (key: string) =>
        setShowText((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    const markMicBlocked = (key: string) => {
        setMicBlocked((prev) => new Set(prev).add(key));
        // Fall back to the typed note field so the item is still captureable.
        setShowText((prev) => new Set(prev).add(key));
    };

    // ---- Voice notes -------------------------------------------------------
    const startRecording = async (key: string) => {
        if (recordingKey) return; // one recorder at a time
        if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof (window as any).MediaRecorder === "undefined") {
            markMicBlocked(key);
            toast({ title: "Voice notes not supported", description: "Use the typed note instead.", variant: "destructive" });
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            const mime = pickAudioMime();
            const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
            chunksRef.current = [];
            recorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
            };
            recorder.onstop = () => {
                const type = recorder.mimeType || mime || "audio/webm";
                const blob = new Blob(chunksRef.current, { type });
                // Release the mic
                streamRef.current?.getTracks().forEach((t) => t.stop());
                streamRef.current = null;
                void uploadVoiceNote(key, blob, type);
            };
            recorderRef.current = recorder;
            recorder.start();
            setRecordingKey(key);
        } catch (e) {
            markMicBlocked(key);
            toast({ title: "Microphone unavailable", description: "Permission denied — use the typed note instead.", variant: "destructive" });
        }
    };

    const stopRecording = () => {
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== "inactive") {
            recorder.stop();
        }
        recorderRef.current = null;
        setRecordingKey(null);
    };

    const uploadVoiceNote = async (key: string, blob: Blob, type: string) => {
        setTranscribingKey(key);
        try {
            const ext = extForMime(type);
            const formData = new FormData();
            formData.append("file", blob, `voice-note.${ext}`);
            const res = await fetch("/api/pricing/survey-audio", { method: "POST", body: formData });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: "Upload failed" }));
                throw new Error(err.error || "Upload failed");
            }
            const data = await res.json();
            patchItem(key, { voiceNoteUrl: data.url, transcript: data.transcript ?? undefined });
            if (!data.transcript) {
                toast({ title: "Voice note saved", description: "Couldn't auto-transcribe, but the audio is attached." });
            }
        } catch (e) {
            toast({ title: "Voice note failed", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
        } finally {
            setTranscribingKey(null);
        }
    };

    const clearVoiceNote = (key: string) => patchItem(key, { voiceNoteUrl: undefined, transcript: undefined });

    // ---- Video -------------------------------------------------------------
    const handleVideoUpload = async (key: string, files: FileList | null) => {
        if (!files || files.length === 0) return;
        setUploadingVideoKey(key);
        try {
            const formData = new FormData();
            Array.from(files).forEach((f) => formData.append("files", f));
            const res = await fetch("/api/pricing/quote-videos", { method: "POST", body: formData });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: "Upload failed" }));
                throw new Error(err.error || "Upload failed");
            }
            const data = await res.json();
            patchItem(key, { videoUrls: [...items[key].videoUrls, ...(data.urls || [])] });
        } catch (e) {
            toast({ title: "Video upload failed", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
        } finally {
            setUploadingVideoKey(null);
        }
    };

    const removeVideo = (key: string, url: string) =>
        patchItem(key, { videoUrls: items[key].videoUrls.filter((u) => u !== url) });

    // ---- Photos ------------------------------------------------------------
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
                        Walk the property and, for each item, just <span className="font-semibold text-slate-700">record a voice note</span> and
                        grab a quick <span className="font-semibold text-slate-700">video</span>. We'll transcribe it for the office. Add a
                        time estimate and who supplies the materials. Skip anything not relevant.
                    </p>
                </div>

                {/* Item cards */}
                <div className="space-y-4">
                    {SURVEY_ITEMS.map((item, idx) => {
                        const st = items[item.key];
                        const isRecording = recordingKey === item.key;
                        const isTranscribing = transcribingKey === item.key;
                        const textOpen = showText.has(item.key);
                        return (
                            <div key={item.key} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                                <div className="px-4 py-3 bg-slate-900 text-white flex items-center gap-2">
                                    <span className="text-xs font-bold bg-white/15 rounded-full w-6 h-6 flex items-center justify-center shrink-0">
                                        {idx + 1}
                                    </span>
                                    <span className="font-semibold text-sm leading-tight">{item.label}</span>
                                </div>
                                <div className="p-4 space-y-4">
                                    {/* PRIMARY: Voice note */}
                                    <div>
                                        <Label className="text-xs font-semibold text-slate-500 flex items-center gap-1">
                                            <Mic className="w-3.5 h-3.5" /> Voice note
                                        </Label>
                                        <div className="mt-2">
                                            {isRecording ? (
                                                <button
                                                    type="button"
                                                    onClick={stopRecording}
                                                    className="w-full h-14 rounded-xl bg-red-600 text-white font-bold text-base flex items-center justify-center gap-2 animate-pulse"
                                                >
                                                    <Square className="w-5 h-5 fill-white" /> Stop &amp; transcribe
                                                </button>
                                            ) : isTranscribing ? (
                                                <div className="w-full h-14 rounded-xl bg-slate-100 text-slate-500 font-semibold text-sm flex items-center justify-center gap-2">
                                                    <Loader2 className="w-5 h-5 animate-spin" /> Transcribing…
                                                </div>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => startRecording(item.key)}
                                                    disabled={!!recordingKey || !!transcribingKey}
                                                    className={`w-full h-14 rounded-xl font-bold text-base flex items-center justify-center gap-2 border-2 transition disabled:opacity-40 ${
                                                        st.voiceNoteUrl
                                                            ? "bg-white text-[#7DB00E] border-[#7DB00E]"
                                                            : "bg-[#7DB00E] text-white border-[#7DB00E]"
                                                    }`}
                                                >
                                                    <Mic className="w-5 h-5" /> {st.voiceNoteUrl ? "Re-record voice note" : "Record voice note"}
                                                </button>
                                            )}
                                        </div>

                                        {st.voiceNoteUrl && !isRecording && !isTranscribing && (
                                            <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                                                <div className="flex items-center gap-2">
                                                    <audio src={st.voiceNoteUrl} controls className="w-full h-9" />
                                                    <button
                                                        type="button"
                                                        onClick={() => clearVoiceNote(item.key)}
                                                        className="shrink-0 text-slate-400 hover:text-red-500"
                                                        aria-label="Remove voice note"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </div>
                                                {st.transcript ? (
                                                    <p className="mt-2 text-sm text-slate-700 leading-snug">
                                                        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Transcript</span>
                                                        <br />
                                                        {st.transcript}
                                                    </p>
                                                ) : (
                                                    <p className="mt-2 text-xs text-slate-400">Audio attached — transcription unavailable.</p>
                                                )}
                                            </div>
                                        )}

                                        {micBlocked.has(item.key) && !st.voiceNoteUrl && (
                                            <p className="mt-2 text-xs text-amber-600">Microphone unavailable — use the typed note below.</p>
                                        )}
                                    </div>

                                    {/* PRIMARY: Video */}
                                    <div>
                                        <Label className="text-xs font-semibold text-slate-500 flex items-center gap-1">
                                            <Video className="w-3.5 h-3.5" /> Video
                                        </Label>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {st.videoUrls.map((url) => (
                                                <div key={url} className="relative w-20 h-20 rounded-md overflow-hidden border border-slate-200 bg-black">
                                                    <video src={url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                                                    <button
                                                        type="button"
                                                        onClick={() => removeVideo(item.key, url)}
                                                        className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5"
                                                    >
                                                        <X className="w-3 h-3 text-white" />
                                                    </button>
                                                </div>
                                            ))}
                                            <label className="w-20 h-20 rounded-md border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 cursor-pointer hover:border-[#7DB00E] hover:text-[#7DB00E]">
                                                {uploadingVideoKey === item.key ? (
                                                    <Loader2 className="w-6 h-6 animate-spin" />
                                                ) : (
                                                    <>
                                                        <Video className="w-6 h-6" />
                                                        <span className="text-[10px] mt-0.5 font-semibold">Record</span>
                                                    </>
                                                )}
                                                <input
                                                    type="file"
                                                    accept="video/*"
                                                    capture="environment"
                                                    className="hidden"
                                                    disabled={uploadingVideoKey === item.key}
                                                    onChange={(e) => {
                                                        void handleVideoUpload(item.key, e.target.files);
                                                        e.target.value = "";
                                                    }}
                                                />
                                            </label>
                                        </div>
                                    </div>

                                    {/* Quick structured fields */}
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

                                    {/* SECONDARY: typed note (collapsed) + photos */}
                                    <div className="pt-1 border-t border-slate-100">
                                        {!textOpen ? (
                                            <button
                                                type="button"
                                                onClick={() => toggleText(item.key)}
                                                className="text-xs font-semibold text-slate-400 hover:text-slate-600 flex items-center gap-1"
                                            >
                                                <Plus className="w-3.5 h-3.5" /> Add typed note
                                            </button>
                                        ) : (
                                            <div className="space-y-3">
                                                <div>
                                                    <Label className="text-xs text-slate-500 flex items-center gap-1">
                                                        <FileText className="w-3.5 h-3.5" /> Scope / what's involved
                                                    </Label>
                                                    <Textarea
                                                        value={st.scope}
                                                        onChange={(e) => patchItem(item.key, { scope: e.target.value })}
                                                        placeholder="What needs doing here…"
                                                        rows={2}
                                                        className="mt-1"
                                                    />
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
                                                <button
                                                    type="button"
                                                    onClick={() => toggleText(item.key)}
                                                    className="text-xs font-semibold text-slate-400 hover:text-slate-600"
                                                >
                                                    Hide typed note
                                                </button>
                                            </div>
                                        )}

                                        {/* Photos (secondary) */}
                                        <div className="mt-3">
                                            <Label className="text-xs text-slate-400">Photos (optional)</Label>
                                            <div className="mt-1.5 flex flex-wrap gap-2">
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
