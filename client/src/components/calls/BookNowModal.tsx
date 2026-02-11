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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
    CreditCard,
    Phone,
    User,
    MapPin,
    Calendar,
    Send,
    MessageSquare,
    Loader2,
    CheckCircle2,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format, addDays } from "date-fns";
import { cn } from "@/lib/utils";

interface DetectedSku {
    id?: string;
    name: string;
    pricePence: number;
    confidence?: number;
    source: 'detected' | 'manual';
}

interface BookNowModalProps {
    open: boolean;
    onClose: () => void;
    customerName: string;
    customerPhone: string;
    customerAddress: string;
    skus: DetectedSku[];
    totalPricePence: number;
    callId?: string;
    onSuccess: () => void;
}

export function BookNowModal({
    open,
    onClose,
    customerName: initialName,
    customerPhone: initialPhone,
    customerAddress: initialAddress,
    skus,
    totalPricePence,
    callId,
    onSuccess,
}: BookNowModalProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Form state
    const [customerName, setCustomerName] = useState(initialName);
    const [customerPhone, setCustomerPhone] = useState(initialPhone);
    const [customerEmail, setCustomerEmail] = useState("");
    const [customerAddress, setCustomerAddress] = useState(initialAddress);
    const [selectedDate, setSelectedDate] = useState<string>("");
    const [sendVia, setSendVia] = useState<'sms' | 'whatsapp'>('sms');

    // Reset form when modal opens with new data
    useEffect(() => {
        if (open) {
            setCustomerName(initialName === 'Incoming Call...' ? '' : initialName);
            setCustomerPhone(initialPhone);
            setCustomerAddress(initialAddress || '');
            setCustomerEmail("");
            setSelectedDate("");
        }
    }, [open, initialName, initialPhone, initialAddress]);

    // Generate date options (next 7 days)
    const dateOptions = Array.from({ length: 7 }, (_, i) => {
        const date = addDays(new Date(), i + 1);
        return {
            value: format(date, 'yyyy-MM-dd'),
            label: format(date, 'EEE, MMM d'),
            isWeekend: date.getDay() === 0 || date.getDay() === 6,
        };
    });

    // Create instant quote mutation
    const createQuoteMutation = useMutation({
        mutationFn: async (data: {
            customerName: string;
            phone: string;
            email?: string;
            address: string;
            skus: DetectedSku[];
            totalPricePence: number;
            selectedDate?: string;
            sendVia: 'sms' | 'whatsapp';
            callId?: string;
        }) => {
            const res = await fetch('/api/quotes/instant', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.error || 'Failed to create quote');
            }
            return res.json();
        },
        onSuccess: (data) => {
            toast({
                title: "Quote Sent!",
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
                title: "Failed to create quote",
                description: error.message,
                variant: "destructive",
            });
        },
    });

    const handleSubmit = () => {
        if (!customerName.trim() || !customerPhone.trim()) {
            toast({
                title: "Missing information",
                description: "Please fill in customer name and phone number",
                variant: "destructive",
            });
            return;
        }

        createQuoteMutation.mutate({
            customerName: customerName.trim(),
            phone: customerPhone.trim(),
            email: customerEmail.trim() || undefined,
            address: customerAddress.trim(),
            skus,
            totalPricePence,
            selectedDate: selectedDate || undefined,
            sendVia,
            callId,
        });
    };

    const isLoading = createQuoteMutation.isPending;

    return (
        <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
            <DialogContent className="max-w-lg bg-slate-950 border-slate-800 text-white">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-xl">
                        <CreditCard className="h-5 w-5 text-green-400" />
                        Create Instant Quote
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Customer Details */}
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label className="text-slate-400">
                                    <User className="h-3 w-3 inline mr-1" />
                                    Name
                                </Label>
                                <Input
                                    value={customerName}
                                    onChange={(e) => setCustomerName(e.target.value)}
                                    placeholder="Customer name"
                                    className="bg-slate-900 border-slate-700"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-slate-400">
                                    <Phone className="h-3 w-3 inline mr-1" />
                                    Phone
                                </Label>
                                <Input
                                    value={customerPhone}
                                    onChange={(e) => setCustomerPhone(e.target.value)}
                                    placeholder="07..."
                                    className="bg-slate-900 border-slate-700"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-slate-400">Email (optional)</Label>
                            <Input
                                value={customerEmail}
                                onChange={(e) => setCustomerEmail(e.target.value)}
                                placeholder="customer@email.com"
                                type="email"
                                className="bg-slate-900 border-slate-700"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label className="text-slate-400">
                                <MapPin className="h-3 w-3 inline mr-1" />
                                Address
                            </Label>
                            <Input
                                value={customerAddress}
                                onChange={(e) => setCustomerAddress(e.target.value)}
                                placeholder="Property address"
                                className="bg-slate-900 border-slate-700"
                            />
                        </div>
                    </div>

                    <Separator className="bg-slate-700" />

                    {/* Services Summary */}
                    <div className="space-y-2">
                        <Label className="text-slate-400">Services</Label>
                        <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-2">
                            {skus.map((sku, index) => (
                                <div key={index} className="flex justify-between text-sm">
                                    <span>{sku.name}</span>
                                    <span className="font-medium">£{(sku.pricePence / 100).toFixed(2)}</span>
                                </div>
                            ))}
                            <Separator className="bg-slate-700" />
                            <div className="flex justify-between font-bold text-lg">
                                <span>Total</span>
                                <span className="text-green-400">£{(totalPricePence / 100).toFixed(2)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Date Selection (Optional) */}
                    <div className="space-y-2">
                        <Label className="text-slate-400">
                            <Calendar className="h-3 w-3 inline mr-1" />
                            Preferred Date (optional)
                        </Label>
                        <div className="flex flex-wrap gap-2">
                            <Badge
                                variant={selectedDate === '' ? 'default' : 'outline'}
                                className={cn(
                                    "cursor-pointer transition-colors",
                                    selectedDate === ''
                                        ? "bg-green-500 text-black"
                                        : "bg-slate-800 hover:bg-slate-700"
                                )}
                                onClick={() => setSelectedDate('')}
                            >
                                Flexible
                            </Badge>
                            {dateOptions.slice(0, 5).map((opt) => (
                                <Badge
                                    key={opt.value}
                                    variant={selectedDate === opt.value ? 'default' : 'outline'}
                                    className={cn(
                                        "cursor-pointer transition-colors",
                                        selectedDate === opt.value
                                            ? "bg-green-500 text-black"
                                            : "bg-slate-800 hover:bg-slate-700"
                                    )}
                                    onClick={() => setSelectedDate(opt.value)}
                                >
                                    {opt.label}
                                </Badge>
                            ))}
                        </div>
                    </div>

                    <Separator className="bg-slate-700" />

                    {/* Send Via */}
                    <div className="space-y-2">
                        <Label className="text-slate-400">Send quote link via</Label>
                        <RadioGroup
                            value={sendVia}
                            onValueChange={(v) => setSendVia(v as 'sms' | 'whatsapp')}
                            className="flex gap-4"
                        >
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="sms" id="sms" />
                                <Label htmlFor="sms" className="cursor-pointer flex items-center gap-1">
                                    <Send className="h-4 w-4" />
                                    SMS
                                </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="whatsapp" id="whatsapp" />
                                <Label htmlFor="whatsapp" className="cursor-pointer flex items-center gap-1">
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
                        disabled={isLoading || !customerName.trim() || !customerPhone.trim()}
                        className="bg-green-500 hover:bg-green-600 text-black font-bold"
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Creating...
                            </>
                        ) : (
                            <>
                                <CheckCircle2 className="h-4 w-4 mr-2" />
                                Create Quote & Send
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
