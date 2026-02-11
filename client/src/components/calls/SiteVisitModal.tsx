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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    MapPin,
    Phone,
    User,
    Send,
    MessageSquare,
    Loader2,
    CheckCircle2,
    AlertTriangle,
    ClipboardList,
    Building2,
    Shield,
    Users,
    Wrench,
    HelpCircle,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const SITE_VISIT_REASONS = [
    { value: 'complex', label: 'Complex job - need to assess', icon: Wrench },
    { value: 'commercial', label: 'Commercial property', icon: Building2 },
    { value: 'safety', label: 'Safety/structural concern', icon: Shield },
    { value: 'customer_prefers', label: 'Customer prefers in-person', icon: Users },
    { value: 'multiple_tasks', label: 'Multiple tasks - need walkthrough', icon: ClipboardList },
    { value: 'other', label: 'Other', icon: HelpCircle },
] as const;

type SiteVisitReason = typeof SITE_VISIT_REASONS[number]['value'];

interface SiteVisitModalProps {
    open: boolean;
    onClose: () => void;
    customerName: string;
    customerPhone: string;
    customerAddress: string;
    callId?: string;
    onSuccess: () => void;
}

export function SiteVisitModal({
    open,
    onClose,
    customerName: initialName,
    customerPhone,
    customerAddress,
    callId,
    onSuccess,
}: SiteVisitModalProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Form state
    const [reason, setReason] = useState<SiteVisitReason | ''>('');
    const [reasonOther, setReasonOther] = useState('');
    const [sendVia, setSendVia] = useState<'sms' | 'whatsapp'>('sms');

    const name = initialName === 'Incoming Call...' ? 'Customer' : initialName;

    // Reset form when modal opens
    useEffect(() => {
        if (open) {
            setReason('');
            setReasonOther('');
            setSendVia('sms');
        }
    }, [open]);

    // Schedule site visit mutation
    const scheduleMutation = useMutation({
        mutationFn: async (data: {
            customerName: string;
            phone: string;
            address: string;
            reason: string;
            reasonOther?: string;
            sendVia: 'sms' | 'whatsapp';
            callId?: string;
        }) => {
            const res = await fetch('/api/site-visits/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.error || 'Failed to schedule site visit');
            }
            return res.json();
        },
        onSuccess: () => {
            toast({
                title: "Site Visit Scheduled",
                description: `Booking link sent to ${customerPhone} via ${sendVia.toUpperCase()}`,
            });
            queryClient.invalidateQueries({ queryKey: ['calls'] });
            if (callId) {
                queryClient.invalidateQueries({ queryKey: ['call', callId] });
            }
            onSuccess();
        },
        onError: (error: Error) => {
            toast({
                title: "Failed to schedule",
                description: error.message,
                variant: "destructive",
            });
        },
    });

    const handleSubmit = () => {
        if (!reason) {
            toast({
                title: "Select a reason",
                description: "Please select why a site visit is needed",
                variant: "destructive",
            });
            return;
        }

        if (reason === 'other' && !reasonOther.trim()) {
            toast({
                title: "Specify reason",
                description: "Please describe why a site visit is needed",
                variant: "destructive",
            });
            return;
        }

        if (!customerPhone.trim()) {
            toast({
                title: "Missing phone number",
                description: "Customer phone number is required",
                variant: "destructive",
            });
            return;
        }

        scheduleMutation.mutate({
            customerName: name,
            phone: customerPhone,
            address: customerAddress,
            reason,
            reasonOther: reason === 'other' ? reasonOther.trim() : undefined,
            sendVia,
            callId,
        });
    };

    const isLoading = scheduleMutation.isPending;

    return (
        <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
            <DialogContent className="max-w-lg bg-slate-950 border-slate-800 text-white">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-xl">
                        <MapPin className="h-5 w-5 text-purple-400" />
                        Schedule Site Visit
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Customer Info Summary */}
                    <div className="flex items-center gap-4 p-3 bg-slate-900 rounded-lg border border-slate-700">
                        <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2 text-sm">
                                <User className="h-3 w-3 text-slate-400" />
                                <span>{name}</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-slate-400">
                                <Phone className="h-3 w-3" />
                                <span>{customerPhone}</span>
                            </div>
                        </div>
                        {customerAddress && (
                            <div className="flex items-center gap-2 text-sm text-slate-400">
                                <MapPin className="h-3 w-3" />
                                <span className="max-w-[150px] truncate">{customerAddress}</span>
                            </div>
                        )}
                    </div>

                    {/* Reason Selection */}
                    <div className="space-y-2">
                        <Label className="text-slate-400">Why is a site visit needed?</Label>
                        <RadioGroup
                            value={reason}
                            onValueChange={(v) => setReason(v as SiteVisitReason)}
                            className="space-y-2"
                        >
                            {SITE_VISIT_REASONS.map((option) => (
                                <div
                                    key={option.value}
                                    className={cn(
                                        "flex items-center space-x-3 p-3 rounded-lg border cursor-pointer transition-colors",
                                        reason === option.value
                                            ? "bg-purple-500/10 border-purple-500/50"
                                            : "bg-slate-900 border-slate-700 hover:border-slate-600"
                                    )}
                                    onClick={() => setReason(option.value)}
                                >
                                    <RadioGroupItem value={option.value} id={option.value} />
                                    <option.icon className={cn(
                                        "h-4 w-4",
                                        reason === option.value ? "text-purple-400" : "text-slate-500"
                                    )} />
                                    <Label htmlFor={option.value} className="cursor-pointer flex-1">
                                        {option.label}
                                    </Label>
                                </div>
                            ))}
                        </RadioGroup>

                        {/* Other reason input */}
                        {reason === 'other' && (
                            <Input
                                value={reasonOther}
                                onChange={(e) => setReasonOther(e.target.value)}
                                placeholder="Describe the reason..."
                                className="bg-slate-900 border-slate-700 mt-2"
                            />
                        )}
                    </div>

                    {/* Assessment Fee Alert */}
                    <Alert className="bg-purple-500/10 border-purple-500/30">
                        <AlertTriangle className="h-4 w-4 text-purple-400" />
                        <AlertDescription className="text-purple-200 text-sm">
                            <div className="font-medium mb-1">Assessment Fee: TBD</div>
                            <div className="flex items-center gap-1 text-purple-300">
                                <CheckCircle2 className="h-3 w-3" />
                                Fully refunded when you accept our quote
                            </div>
                        </AlertDescription>
                    </Alert>

                    {/* Send Via */}
                    <div className="space-y-2">
                        <Label className="text-slate-400">Send booking link via</Label>
                        <RadioGroup
                            value={sendVia}
                            onValueChange={(v) => setSendVia(v as 'sms' | 'whatsapp')}
                            className="flex gap-4"
                        >
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="sms" id="sms-visit" />
                                <Label htmlFor="sms-visit" className="cursor-pointer flex items-center gap-1">
                                    <Send className="h-4 w-4" />
                                    SMS
                                </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="whatsapp" id="whatsapp-visit" />
                                <Label htmlFor="whatsapp-visit" className="cursor-pointer flex items-center gap-1">
                                    <MessageSquare className="h-4 w-4 text-green-400" />
                                    WhatsApp
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>
                </div>

                <DialogFooter className="flex gap-2">
                    <Button variant="ghost" onClick={onClose} disabled={isLoading}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={isLoading || !reason || (reason === 'other' && !reasonOther.trim())}
                        className="bg-purple-500 hover:bg-purple-600 text-white font-bold"
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Scheduling...
                            </>
                        ) : (
                            <>
                                <Send className="h-4 w-4 mr-2" />
                                Send Booking Link
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
