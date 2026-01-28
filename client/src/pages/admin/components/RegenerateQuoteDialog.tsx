import { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, RefreshCw } from 'lucide-react';

interface RegenerateQuoteDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (percentageIncrease: number) => Promise<void>;
    quoteCustomerName: string;
}

export function RegenerateQuoteDialog({
    open,
    onOpenChange,
    onConfirm,
    quoteCustomerName,
}: RegenerateQuoteDialogProps) {
    const [percentage, setPercentage] = useState(5);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleConfirm = async () => {
        try {
            setIsSubmitting(true);
            await onConfirm(percentage);
            onOpenChange(false);
        } catch (error) {
            console.error('Failed to regenerate quote', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <RefreshCw className="h-5 w-5 text-blue-500" />
                        Regenerate Quote
                    </DialogTitle>
                    <DialogDescription>
                        Create a fresh copy of the quote for <strong>{quoteCustomerName}</strong> with updated pricing.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="uplift" className="text-right">
                            Uplift %
                        </Label>
                        <div className="col-span-3 relative">
                            <Input
                                id="uplift"
                                type="number"
                                value={percentage}
                                onChange={(e) => setPercentage(Number(e.target.value))}
                                className="pr-8"
                                min={0}
                                max={100}
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
                                %
                            </span>
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground ml-[25%] px-1">
                        Standard yearly price increase is usually 5-10%.
                    </p>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button onClick={handleConfirm} disabled={isSubmitting}>
                        {isSubmitting ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Regenerating...
                            </>
                        ) : (
                            'Regenerate Quote'
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
