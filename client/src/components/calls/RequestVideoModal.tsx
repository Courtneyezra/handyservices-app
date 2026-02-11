import React, { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    Video,
    Phone,
    Send,
    Loader2,
    Info,
    CheckCircle2,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface RequestVideoModalProps {
    open: boolean;
    onClose: () => void;
    customerName: string;
    customerPhone: string;
    detectedContext?: string;
    callId?: string;
    onSuccess: () => void;
}

export function RequestVideoModal({
    open,
    onClose,
    customerName: initialName,
    customerPhone,
    detectedContext,
    callId,
    onSuccess,
}: RequestVideoModalProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Form state
    const [context, setContext] = useState("");
    const name = initialName === 'Incoming Call...' ? 'there' : initialName;

    // Reset form when modal opens
    useEffect(() => {
        if (open) {
            // Extract meaningful context from transcription
            const defaultContext = detectedContext
                ? extractContext(detectedContext)
                : "the work required";
            setContext(defaultContext);
        }
    }, [open, detectedContext]);

    // Extract meaningful context from transcription
    function extractContext(text: string): string {
        // Look for common problem phrases
        const problemPatterns = [
            /(?:problem with|issue with|need .* fixed|need .* repaired)\s+(.{10,50})/i,
            /(?:my|the)\s+([\w\s]+(?:tap|toilet|door|window|sink|boiler|radiator|wall|ceiling|floor))/i,
            /(?:leaking|broken|stuck|damaged|faulty)\s+([\w\s]+)/i,
        ];

        for (const pattern of problemPatterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1].trim().toLowerCase();
            }
        }

        // Fallback to first 50 characters of meaningful text
        const cleaned = text.replace(/^(hello|hi|hey|um|uh|so|well|yeah)\s*/i, '').trim();
        if (cleaned.length > 10) {
            return cleaned.substring(0, 50).toLowerCase();
        }

        return "the work required";
    }

    // Generate preview message
    const previewMessage = `Hi ${name}, as discussed, please send us a video of ${context}. This will help us provide an accurate quote.`;

    // Send video request mutation
    const sendVideoMutation = useMutation({
        mutationFn: async (data: {
            phone: string;
            customerName: string;
            context: string;
            callId?: string;
        }) => {
            const res = await fetch('/api/whatsapp/send-template', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    number: data.phone,
                    template: 'request_video',
                    customerName: data.customerName,
                    context: data.context,
                    callId: data.callId,
                }),
            });
            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.error || 'Failed to send video request');
            }
            return res.json();
        },
        onSuccess: () => {
            toast({
                title: "Video Request Sent",
                description: `WhatsApp message sent to ${customerPhone}`,
            });
            queryClient.invalidateQueries({ queryKey: ['calls'] });
            if (callId) {
                queryClient.invalidateQueries({ queryKey: ['call', callId] });
            }
            onSuccess();
        },
        onError: (error: Error) => {
            toast({
                title: "Failed to send request",
                description: error.message,
                variant: "destructive",
            });
        },
    });

    const handleSubmit = () => {
        if (!customerPhone.trim()) {
            toast({
                title: "Missing phone number",
                description: "Customer phone number is required",
                variant: "destructive",
            });
            return;
        }

        sendVideoMutation.mutate({
            phone: customerPhone,
            customerName: name,
            context: context.trim() || "the work required",
            callId,
        });
    };

    const isLoading = sendVideoMutation.isPending;

    return (
        <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
            <DialogContent className="max-w-md bg-slate-950 border-slate-800 text-white">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-xl">
                        <Video className="h-5 w-5 text-blue-400" />
                        Request Video via WhatsApp
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Phone Number (Read-only) */}
                    <div className="space-y-2">
                        <Label className="text-slate-400">
                            <Phone className="h-3 w-3 inline mr-1" />
                            Send to
                        </Label>
                        <Input
                            value={customerPhone}
                            readOnly
                            className="bg-slate-900 border-slate-700 text-slate-300"
                        />
                    </div>

                    {/* Context Input */}
                    <div className="space-y-2">
                        <Label className="text-slate-400">
                            What should they show?
                        </Label>
                        <Input
                            value={context}
                            onChange={(e) => setContext(e.target.value)}
                            placeholder="e.g., the leaking tap, the broken door"
                            className="bg-slate-900 border-slate-700"
                        />
                        <p className="text-xs text-slate-500">
                            This will be included in the message to the customer
                        </p>
                    </div>

                    {/* Message Preview */}
                    <div className="space-y-2">
                        <Label className="text-slate-400 flex items-center gap-1">
                            <Info className="h-3 w-3" />
                            Message Preview
                        </Label>
                        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                            <p className="text-sm text-slate-300 whitespace-pre-wrap">
                                {previewMessage}
                            </p>
                        </div>
                    </div>

                    {/* WhatsApp Info */}
                    <Alert className="bg-blue-500/10 border-blue-500/30">
                        <Video className="h-4 w-4 text-blue-400" />
                        <AlertDescription className="text-blue-200 text-sm">
                            This will send a WhatsApp message using our approved template.
                            The customer can reply with a video within 24 hours.
                        </AlertDescription>
                    </Alert>
                </div>

                <DialogFooter className="flex gap-2">
                    <Button variant="ghost" onClick={onClose} disabled={isLoading}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={isLoading || !customerPhone.trim()}
                        className="bg-blue-500 hover:bg-blue-600 text-white font-bold"
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Sending...
                            </>
                        ) : (
                            <>
                                <Send className="h-4 w-4 mr-2" />
                                Send Request
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
