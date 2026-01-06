import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Rocket, ShieldCheck, UserCircle, CheckCircle2 } from 'lucide-react';
import { useLocation } from 'wouter';
import { useState, useEffect } from 'react';

interface SmartSetupModalProps {
    isOpen: boolean;
    onClose: () => void;
    profileStrength: number;
    missingItems: string[];
}

export function SmartSetupModal({ isOpen, onClose, profileStrength, missingItems }: SmartSetupModalProps) {
    const [, setLocation] = useLocation();

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md bg-white border-0 shadow-2xl">
                <div className="absolute top-0 w-full h-1 bg-gradient-to-r from-amber-400 to-orange-500 rounded-t-lg" />

                <DialogHeader className="pt-6">
                    <div className="mx-auto w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mb-4">
                        <Rocket className="w-6 h-6 text-amber-600" />
                    </div>
                    <DialogTitle className="text-center text-xl font-bold text-slate-900">
                        You're invisible to customers!
                    </DialogTitle>
                    <DialogDescription className="text-center text-slate-500 pt-2">
                        Your public profile is currently hidden. Activate it now to start getting bookings and quotes directly from Google.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-4">
                    {/* Progress Bar */}
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                        <div className="flex justify-between text-sm mb-2">
                            <span className="font-semibold text-slate-700">Profile Strength</span>
                            <span className="font-bold text-amber-600">{profileStrength}%</span>
                        </div>
                        <div className="h-2.5 bg-slate-200 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-1000"
                                style={{ width: `${profileStrength}%` }}
                            />
                        </div>
                    </div>

                    {/* Benefits / Missing Items */}
                    <div className="space-y-2">
                        {missingItems.map((item, idx) => (
                            <div key={idx} className="flex items-center gap-3 p-2 text-sm text-slate-600">
                                <div className="w-5 h-5 rounded-full border-2 border-slate-200 flex-shrink-0" />
                                <span>{item}</span>
                            </div>
                        ))}
                        <div className="flex items-center gap-3 p-2 text-sm text-emerald-700 bg-emerald-50 rounded-lg">
                            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                            <span className="font-medium">Get Verified Badge</span>
                        </div>
                    </div>
                </div>

                <DialogFooter className="flex-col sm:flex-col gap-2">
                    <Button
                        onClick={() => setLocation('/contractor/profile')}
                        className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl shadow-lg shadow-slate-900/10"
                    >
                        Setup Profile Now
                    </Button>
                    <Button
                        onClick={onClose}
                        variant="ghost"
                        className="w-full text-slate-400 hover:text-slate-600"
                    >
                        I'll do it later
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
