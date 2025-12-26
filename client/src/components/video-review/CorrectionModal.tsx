import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface CorrectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: any) => void;
}

export function CorrectionModal({ isOpen, onClose, onSubmit }: CorrectionModalProps) {
    const [reason, setReason] = useState('different_issue');
    const [details, setDetails] = useState('');

    const handleSubmit = () => {
        onSubmit({ reason, details });
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>What did we get wrong?</DialogTitle>
                    <DialogDescription>
                        Help us understand what you need so we can give you an accurate quote.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    <RadioGroup value={reason} onValueChange={setReason} className="space-y-3">
                        <div className="flex items-start space-x-3">
                            <RadioGroupItem value="different_issue" id="r1" className="mt-1" />
                            <div className="grid gap-1.5 leading-none">
                                <Label htmlFor="r1" className="font-semibold cursor-pointer">Different issue entirely</Label>
                                <span className="text-sm text-muted-foreground">The AI identified the wrong problem</span>
                            </div>
                        </div>
                        <div className="flex items-start space-x-3">
                            <RadioGroupItem value="multiple_jobs" id="r2" className="mt-1" />
                            <div className="grid gap-1.5 leading-none">
                                <Label htmlFor="r2" className="font-semibold cursor-pointer">Multiple jobs needed</Label>
                                <span className="text-sm text-muted-foreground">There's more than just this one task</span>
                            </div>
                        </div>
                        <div className="flex items-start space-x-3">
                            <RadioGroupItem value="less_urgent" id="r3" className="mt-1" />
                            <div className="grid gap-1.5 leading-none">
                                <Label htmlFor="r3" className="font-semibold cursor-pointer">Less urgent / Minor issue</Label>
                                <span className="text-sm text-muted-foreground">It's not as bad as it looks</span>
                            </div>
                        </div>
                    </RadioGroup>

                    <div className="space-y-2">
                        <Label>Tell us what you actually need</Label>
                        <Textarea
                            placeholder="E.g. It's actually the shower unit that's leaking, not the tap..."
                            value={details}
                            onChange={(e) => setDetails(e.target.value)}
                            className="resize-none"
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleSubmit}>Update</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
