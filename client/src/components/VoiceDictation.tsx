import { useState, useRef } from "react";
import { Mic, Square, Loader2, Sparkles, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface VoiceDictationProps {
    onTranscriptionComplete: (text: string) => void;
    className?: string;
    theme?: 'light' | 'dark';
}

export function VoiceDictation({ onTranscriptionComplete, className, theme = 'dark' }: VoiceDictationProps) {
    const [isRecording, setIsRecording] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    const startRecording = async () => {
        setError(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorderRef.current = new MediaRecorder(stream);
            chunksRef.current = [];

            mediaRecorderRef.current.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunksRef.current.push(e.data);
                }
            };

            mediaRecorderRef.current.onstop = async () => {
                setIsProcessing(true);
                const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });

                // Prepare form data
                const formData = new FormData();
                formData.append('file', audioBlob, 'recording.webm');

                try {
                    const res = await fetch('/api/transcribe', {
                        method: 'POST',
                        body: formData,
                    });

                    if (!res.ok) throw new Error('Transcription failed');

                    const data = await res.json();
                    if (data.text) {
                        onTranscriptionComplete(data.text);
                    }
                } catch (err) {
                    console.error("Transcription error:", err);
                    setError("Failed to process audio. Please try again.");
                } finally {
                    setIsProcessing(false);
                    // Stop tracks to release mic
                    stream.getTracks().forEach(track => track.stop());
                }
            };

            mediaRecorderRef.current.start();
            setIsRecording(true);
        } catch (err) {
            console.error("Mic access error:", err);
            setError("Microphone access denied.");
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    };

    return (
        <div className={cn("flex flex-col items-center gap-2", className)}>
            {error && (
                <div className="text-red-400 text-xs flex items-center gap-1 animate-in fade-in">
                    <AlertCircle className="w-3 h-3" />
                    {error}
                </div>
            )}

            <Button
                type="button"
                variant={isRecording ? "destructive" : "secondary"}
                size="lg"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isProcessing}
                className={cn(
                    "rounded-full w-16 h-16 flex items-center justify-center transition-all shadow-lg",
                    isRecording
                        ? "animate-pulse bg-red-500 hover:bg-red-600 ring-4 ring-red-500/30"
                        : theme === 'light'
                            ? "bg-white hover:bg-slate-50 border border-slate-200 shadow-slate-200/50 text-slate-700"
                            : "bg-slate-800 hover:bg-slate-700 hover:scale-105 border border-slate-700",
                    isProcessing ? "opacity-80" : ""
                )}
            >
                {isProcessing ? (
                    <Loader2 className={cn("w-8 h-8 animate-spin", theme === 'light' ? "text-[#6C6CFF]" : "text-amber-500")} />
                ) : isRecording ? (
                    <Square className="w-6 h-6 fill-white" />
                ) : (
                    <Mic className={cn("w-8 h-8", theme === 'light' ? "text-[#6C6CFF]" : "text-amber-500")} />
                )}
            </Button>

            <span className={cn(
                "text-xs font-medium uppercase tracking-widest",
                theme === 'light' ? "text-slate-400" : "text-slate-500"
            )}>
                {isProcessing ? "Transcribing..." : isRecording ? "Recording..." : "Tap to Dictate"}
            </span>
        </div>
    );
}
