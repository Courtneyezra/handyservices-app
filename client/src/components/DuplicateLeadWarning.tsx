import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, User, MapPin, Phone, History } from 'lucide-react';
import { format } from 'date-fns';

interface ExistingLeadInfo {
    id: string;
    customerName: string;
    phone: string;
    address?: string | null;
    lastContact?: string; // Date string
    status?: string;
}

interface DuplicateLeadWarningProps {
    isOpen: boolean;
    confidence: number;
    matchReason: string;
    existingLead: ExistingLeadInfo;
    onUpdateExisting: () => void;
    onCreateNew: () => void;
}

export function DuplicateLeadWarning({
    isOpen,
    confidence,
    matchReason,
    existingLead,
    onUpdateExisting,
    onCreateNew
}: DuplicateLeadWarningProps) {
    return (
        <Dialog open={isOpen} onOpenChange={() => { }}>
            <DialogContent className="sm:max-w-md bg-white dark:bg-slate-950 text-foreground border-border">
                <DialogHeader>
                    <div className="flex items-center gap-2 text-amber-500 mb-2">
                        <AlertTriangle className="h-6 w-6" />
                        <DialogTitle>Duplicate Lead Detected</DialogTitle>
                    </div>
                    <DialogDescription className="text-muted-foreground">
                        We found an existing lead that matches this call with <strong>{confidence}% confidence</strong>.
                    </DialogDescription>
                </DialogHeader>

                <div className="bg-muted/50 rounded-lg p-4 space-y-3 border border-border/50">
                    <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">
                        Existing Lead Found
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                            <User className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div>
                            <div className="font-medium text-foreground">{existingLead.customerName}</div>
                            <div className="text-xs text-muted-foreground">{matchReason}</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2 text-sm text-muted-foreground mt-2">
                        <div className="flex items-center gap-2">
                            <Phone className="h-4 w-4 text-muted-foreground" />
                            <span>{existingLead.phone}</span>
                        </div>
                        {existingLead.address && (
                            <div className="flex items-center gap-2">
                                <MapPin className="h-4 w-4 text-muted-foreground" />
                                <span className="truncate">{existingLead.address}</span>
                            </div>
                        )}
                        {existingLead.lastContact && (
                            <div className="flex items-center gap-2">
                                <History className="h-4 w-4 text-muted-foreground" />
                                <span>Last contacted: {format(new Date(existingLead.lastContact), 'MMM d, yyyy')}</span>
                            </div>
                        )}
                    </div>
                </div>

                <DialogFooter className="flex-col sm:flex-row gap-2 mt-4">
                    <Button
                        variant="ghost"
                        onClick={onCreateNew}
                        className="sm:order-1 text-muted-foreground hover:text-foreground"
                    >
                        Create New Lead Anyway
                    </Button>
                    <Button
                        onClick={onUpdateExisting}
                        className="sm:order-2 bg-emerald-600 hover:bg-emerald-700 text-white w-full sm:w-auto"
                    >
                        ✓ Update Existing Lead
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
